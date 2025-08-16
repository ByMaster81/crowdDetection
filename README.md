# ESP32 Trilaterasyon ve MQTT Konum Takip Projesi

Bu proje, ESP32 cihazlarından MQTT ile alınan RSSI verilerini kullanarak cihazların konumunu trilaterasyon yöntemiyle tahmin eder ve web arayüzü üzerinden sunar.

---

## Başlangıç (Setup)

### Gereksinimler
- Node.js (tercihen 16+)
- MQTT Broker (örneğin Mosquitto)
- İnternet bağlantısı veya yerel ağ

### Projeyi Klonlama ve Bağımlılıkları Kurma

```bash
git clone <repo-url>
cd <proje-klasoru>
npm install
```

### Ortam Değişkenleri

JWT güvenliği için güçlü bir `JWT_SECRET` belirleyin:

```bash
export JWT_SECRET="cok-gizli-ve-uzun-bir-anahtar"
```

veya `.env` dosyası kullanabilirsiniz.

### Config Dosyası (`config.json`)

`config.json` dosyası şu yapıya sahiptir:

```json
{
  "espPositions": {
    "esp1": { "x": 0, "y": 0 },
    "esp2": { "x": 10, "y": 0 },
    "esp3": { "x": 5, "y": 10 }
  },
  "distanceCalculation": {
    "txPower": -49,
    "n_factor": 3.1
  },
  "trilateration": {
    "lm_options": {
      "damping": 0.02,
      "initialValues": [5, 5],
      "gradientDifference": 1e-6,
      "maxIterations": 100,
      "errorTolerance": 1e-3
    }
  }
}
```

---

## API Endpoints

| Yöntem | Yol                | Açıklama                        | JWT Gerekiyor? |
|--------|--------------------|--------------------------------|---------------|
| GET    | `/api/config`       | Konfigürasyon verisini getirir | Hayır         |
| POST   | `/api/config`       | Konfigürasyon günceller        | Evet          |
| GET    | `/api/data`         | Güncel konumları verir         | Hayır         |
| POST   | `/api/admin/login`  | Admin girişi, JWT alır         | Hayır         |

---

## MQTT Mesaj Formatı

Projeye gönderilen MQTT mesajları şu formatta olmalıdır:

```
ESP:<espId>|MAC:<mac_address>|RSSI:<rssi_value>
```

Örnek:

```
ESP:esp1|MAC:AA:BB:CC:DD:EE:FF|RSSI: -65
```

---

## Güvenlik Notları

- JWT kullanılarak admin işlemleri korunmaktadır.
- Prod ortamda `JWT_SECRET` mutlaka güçlü ve ortam değişkeni olarak ayarlanmalıdır.
- Şifreler şu anda kodda sabit; ileride veritabanı ve hash’leme önerilir.
- Rate limiting ve brute force koruması eklenmemiştir, dikkat ediniz.

---

## Bilinen Eksiklikler ve Geliştirme Önerileri

- MQTT bağlantısı koparsa otomatik yeniden bağlanma yok.
- `mqttData` yapısı büyüyebilir, eski verilerin temizlenmesi gerekebilir.
- HTTPS desteği yok, prod’da reverse proxy ile eklenmeli.
- Loglama basit, gelişmiş loglama kütüphaneleri önerilir.

---

## Lisans

MIT Lisansı — dilediğiniz gibi kullanabilirsiniz.

---

**Proje hakkında soru veya öneriler için iletişime geçebilirsiniz.**
