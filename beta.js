
const express = require('express');
const mqtt = require('mqtt');
const path = require('path');
const { levenbergMarquardt: LM } = require('ml-levenberg-marquardt');
const fs = require('fs').promises;
const fsSync = require('fs');
const jwt = require('jsonwebtoken'); // JWT paketini dahil et

const app = express();
const port = 3001;

// ÖNEMLİ: Gerçek bir uygulamada bu anahtarı ortam değişkenlerinden (environment variable) alın
// ve çok daha karmaşık, güvenli bir anahtar kullanın.
const JWT_SECRET = process.env.JWT_SECRET || 'bu-cok-gizli-bir-jwt-anahtari-olmalı-12345!';

let mqttData = {}; // { "mac": { espId: { rssi, timestamp } } }

app.use(express.static('frontend'));
app.use(express.json());

const connectionArgs = {
  host: '37.140.242.180',
  port: '1883',
  username: 'esp32',
  password: 'p8qfn2od3h'
};

const client = mqtt.connect(connectionArgs);

client.on('connect', () => {
  console.log('MQTT Broker\'a bağlanıldı.');
  client.subscribe('esp32/test', (err) => {
    if (err) console.error('Abone olurken hata:', err);
  });
});

const regex = /ESP:\s*(\w+)\s*\|\s*MAC:\s*([0-9A-Fa-f:]+)\s*\|\s*RSSI:\s*(-?\d+)/;

client.on('message', (topic, message) => {
  const msg = message.toString();
  console.log(`MQTT: ${msg}`);

  const match = msg.match(regex);
  if (!match) {
    console.error('Geçersiz MQTT mesaj formatı:', msg);
    return;
  }

  const espId = match[1];
  const mac = match[2];
  const rssi = parseInt(match[3], 10);
  const timestamp = Date.now();
  // --- YENİ EKLENEN KISIM ---
  // RSSI'dan mesafeyi anında hesapla
  const distance = rssiToDistance(rssi);
  // Hesaplanan mesafeyi konsola yazdır
  console.log(`>>> HESAPLAMA: Gelen RSSI (${rssi}) için hesaplanan mesafe: ${distance.toFixed(2)} metre`);
  // --- YENİ EKLENEN KISIM BİTTİ ---

  if (!mqttData[mac]) mqttData[mac] = {};
  mqttData[mac][espId] = { rssi, timestamp };
});

function rssiToDistance(rssi) {
  // Config'den değerleri oku, eğer yoksa varsayılan değerleri kullan (güvenlik için)
  const txPower = config?.distanceCalculation?.txPower ?? -49;
  const n = config?.distanceCalculation?.n_factor ?? 3.1;
  
  return Math.pow(10, (txPower - rssi) / (10 * n));
}

let config;
try {
    config = JSON.parse(fsSync.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));
} catch (err) {
    console.error("Başlangıçta config dosyası okunamadı! Varsayılan bir config kullanılacak.", err);
    // Hata durumunda bile temel bir config objesi oluştur
    config = { 
        espPositions: {},
        distanceCalculation: { txPower: -49, n_factor: 3.1 },
        trilateration: { lm_options: { damping: 0.02, initialValues: [5, 5], gradientDifference: 1e-6, maxIterations: 100, errorTolerance: 1e-3 } }
    };
}

setInterval(async () => {
  try {
    const configFileContent = await fs.readFile(path.join(__dirname, 'config.json'), 'utf-8');
    config = JSON.parse(configFileContent);
  } catch (err) {
    console.error('Config dosyasını periyodik olarak yeniden yüklerken hata oluştu:', err);
  }
}, 5000);

// --- JWT Kimlik Doğrulama Middleware'i ---
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // "Bearer TOKEN_STRING" formatından token'ı al

  if (token == null) {
    return res.status(401).json({ success: false, message: 'Erişim yetkisi bulunmamaktadır. Token eksik.' });
  }

  jwt.verify(token, JWT_SECRET, (err, userPayload) => {
    if (err) {
      console.error('JWT Doğrulama Hatası:', err.message);
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ success: false, message: 'Oturum süresi dolmuş. Lütfen tekrar giriş yapın.' });
      }
      return res.status(403).json({ success: false, message: 'Geçersiz token. Erişim reddedildi.' });
    }
    req.user = userPayload; // Doğrulanmış kullanıcı bilgilerini request objesine ekle
    next(); // Token geçerli, sonraki işleme devam et
  });
}
// --- ---

app.get('/api/config', async (req, res) => {
  if (config) {
      res.json(config);
  } else {
      res.status(500).json({ error: 'Config verisi mevcut değil.' });
  }
});

function fittingFunction([deviceX, deviceY]) {
  return (espCoords) => {
    return Math.sqrt(Math.pow(deviceX - espCoords.x, 2) + Math.pow(deviceY - espCoords.y, 2));
  };
}

// Config kaydetme işlemini JWT ile koru
app.post('/api/config', authenticateToken, async (req, res) => {
  // req.user sayesinde hangi kullanıcının bu işlemi yaptığını bilebiliriz (eğer token payload'ında varsa)
  console.log(`Konfigürasyon güncelleniyor, istek yapan kullanıcı: ${req.user.username}`);
  try {
    const newConfig = req.body;
    await fs.writeFile(path.join(__dirname, 'config.json'), JSON.stringify(newConfig, null, 2));
    config = newConfig;
    res.json({ success: true, message: "Konfigürasyon başarıyla güncellendi." });
  } catch (err) {
    console.error("Config yazma hatası:", err);
    res.status(500).json({ success: false, message: "Konfigürasyon dosyası yazılamadı", error: err.message });
  }
});

function trilaterate(macEntry) {
  const now = Date.now();
  const activeEspData = [];
  if (!config || !config.espPositions) {
      console.warn('Trilaterasyon için ESP pozisyonları (config.espPositions) yüklenemedi veya tanımsız.');
      return null;
  }
  const espPositions = config.espPositions;

  for (const [espId, data] of Object.entries(macEntry)) {
    if (now - data.timestamp <= 60000 && espPositions[espId]) {
      activeEspData.push({
        esp_x: espPositions[espId].x,
        esp_y: espPositions[espId].y,
        dist: rssiToDistance(data.rssi)
      });
    }
  }

  if (activeEspData.length < 3) return null;

  const lmData = {
    x: activeEspData.map(p => ({ x: p.esp_x, y: p.esp_y })),
    y: activeEspData.map(p => p.dist)
  };

  // Levenberg-Marquardt için varsayılan opsiyonları tanımla
  const defaultOptions = {
    damping: 0.02,
    initialValues: [5, 5],
    gradientDifference: 1e-6,
    maxIterations: 100,
    errorTolerance: 1e-3
  };

  // Config dosyasından gelen opsiyonları varsayılanların üzerine yaz
  const options = {
      ...defaultOptions,
      ...(config?.trilateration?.lm_options || {})
  };


  try {
    const result = LM(lmData, fittingFunction, options);
    if (result && result.parameterValues) {
        return { x: result.parameterValues[0], y: result.parameterValues[1] };
    } else {
        console.error('LM algoritması geçerli bir sonuç döndürmedi:', result);
        return null;
    }
  } catch (error) {
    console.error('Trilaterasyon sırasında hata:', error);
    return null;
  }
}


app.get('/api/data', (req, res) => {
  const result = {};
  for (const [mac, espReadings] of Object.entries(mqttData)) {
    const pos = trilaterate(espReadings);
    if (pos) result[mac] = pos;
  }
  res.json(result);
});

app.use('/admin', express.static('frontend/admin'));

// Admin giriş endpoint'i - Başarılı girişte JWT döndürür
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  // GERÇEK BİR UYGULAMADA: Kullanıcı adı ve şifreyi veritabanından kontrol edin
  // ve şifreleri hash'lenmiş olarak saklayın (bcrypt gibi).
  if (username === 'admin' && password === 'admin123') {
    const userPayload = { username: username, role: 'admin' }; // Token içine eklenecek bilgi
    const accessToken = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '1h' }); // Token 1 saat geçerli
    res.json({ success: true, message: 'Giriş başarılı', token: accessToken });
  } else {
    res.status(401).json({ success: false, message: 'Kullanıcı adı veya şifre hatalı' });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Web sunucu ${port} portunda çalışıyor!`);
});


