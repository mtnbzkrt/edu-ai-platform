# ORCHESTRATION.md

## Amaç
Bu yapı, eğitim AI sisteminde konuşmaları doğru ana agente yönlendirmek ve gerektiğinde görev bazlı alt-agent akışlarını çalıştırmak için kullanılır.

## Ana prensip
- Kullanıcı tipi ana agent seçimini belirler.
- İstek tipi alt-agent ihtiyacını belirler.
- Ana agent kullanıcıyla konuşur.
- Alt-agent kullanıcıyla doğrudan persona kurmaz; iş üretir, analiz yapar, çıktı hazırlar.
- Alt-agent'lar sadece gerektiğinde çağrılır.
- Veri yorumlama öncelikle ana agent + gerekirse uzman alt-agent iş birliği ile yapılır.

## Ana agentlar
- learner-agent: Öğrenci ile konuşur.
- teacher-agent: Öğretmen ile konuşur.
- parent-agent: Veli ile konuşur.

## Uzman alt-agentlar
- retrieval-agent: Büyük veri çekim planını yapar, gerekli tool çağrı sırasını belirler.
- assessment-agent: Sınav, quiz, kazanım, soru performansı, başarı düşüşü ve konu bazlı zayıflıkları analiz eder.
- study-plan-agent: Öğrenci için çalışma planı, tekrar akışı, haftalık program ve öncelik sırası çıkarır.
- content-agent: Konu anlatımı, mini quiz, örnek soru, ödev önerisi, etüt akışı ve açıklama şablonu üretir.
- report-agent: Öğretmen özeti, veli özeti, aylık durum raporu, kısa yönetici özeti üretir.
- risk-agent: Riskli öğrenci, düşen başarı trendi, devamsızlık etkisi, ödev tamamlamama, sınav düşüşü gibi durumları işaretler.

## Routing kuralları

### 1. Rol bazlı ilk yönlendirme
- role = student -> learner-agent
- role = teacher -> teacher-agent
- role = parent -> parent-agent

### 2. Niyet bazlı ikinci yönlendirme
Ana agent aşağıdaki niyetleri tespit eder:
- konu anlatımı
- performans analizi
- sınav yorumu
- çalışma planı
- rapor oluşturma
- soru/quiz üretme
- risk analizi
- çok adımlı veri çekimi

## Örnek akışlar

### Öğrenci: "Son 3 sınavıma göre hangi konuları tekrar etmeliyim?"
1. learner-agent
2. retrieval-agent
3. assessment-agent
4. study-plan-agent
5. learner-agent nihai cevap

### Öğretmen: "8B'de matematikte en çok zorlanan öğrenciler kimler?"
1. teacher-agent
2. retrieval-agent
3. assessment-agent
4. risk-agent
5. teacher-agent nihai cevap

### Veli: "Bu ay çocuğumun durumu nasıl?"
1. parent-agent
2. retrieval-agent
3. assessment-agent
4. report-agent
5. parent-agent nihai cevap
