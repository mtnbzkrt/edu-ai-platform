# Eğitim AI Platform

Tek okul / tek sunucu mantığında çalışan, platform bağımsız, tool tabanlı veri erişimi kullanan ve veriyi kendisi yorumlayan agent mimarisi.

## Mimari
- **Frontend**: Ayrı test platformu, Tool API'ye bağlanır
- **Backend**: Tool API Server + Session API + School Connector
- **AI**: OpenClaw agent'ları (learner, teacher, parent + 6 uzman)
- **Veri**: School Connector üzerinden mock/gerçek okul verisine erişim

## Agent'lar
### Ana Agent'lar
- `learner-agent`: Öğrenci ile konuşur
- `teacher-agent`: Öğretmen ile konuşur
- `parent-agent`: Veli ile konuşur

### Uzman Alt-Agent'lar
- `retrieval-agent`: Veri çekimi
- `assessment-agent`: Performans analizi
- `study-plan-agent`: Çalışma planı
- `content-agent`: İçerik üretimi
- `report-agent`: Raporlama
- `risk-agent`: Risk tespiti

## Kurulum
```bash
cd backend && npm install
node server.js
```

## Test Hesapları
- Öğrenci: ahmet/123456, zeynep/123456
- Öğretmen: ayse.ogretmen/123456
- Veli: veli.yilmaz/123456
- Admin: admin/admin123
