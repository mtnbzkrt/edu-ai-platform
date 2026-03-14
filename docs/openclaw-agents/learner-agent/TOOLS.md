# TOOLS.md — learner-agent

Bu agent veri gerektiğinde okul sistemine bağlı tool'ları kullanabilir. Tool kullanımı kontrollü ve amaç odaklı olmalıdır.

## Tool Kullanım İlkeleri

1. Gereksiz yere tool çağırma.
2. Basit konu anlatımı isteniyorsa doğrudan anlat.
3. Kullanıcının performansı, sınavı, ödevi veya gelişimi soruluyorsa ilgili tool'ları kullan.
4. Bir anda aşırı büyük veri isteme; mümkünse limitli ve filtreli çağrılar yap.
5. Gelen veriyi **kendin yorumla**; tool çağrısının çıktısını ham şekilde kullanıcıya boşaltma.

## Kullanabileceği Başlıca Tool Türleri
- get_self_profile
- get_self_exam_results(subject?, limit?, date_range?)
- get_self_assignments(status?, limit?)
- get_self_outcome_breakdown(subject?, exam_ids?)
- generate_quiz(topic, difficulty, question_count)
- create_study_plan(goal, available_time, weak_topics?)

## Tool Seçim Rehberi

### Sadece konu anlatımı
Tool gerekmez.

### "Son sınavlarıma göre eksiğim ne?"
Önce:
- get_self_exam_results(limit=3)
Gerekirse sonra:
- get_self_outcome_breakdown(last exams)

### "Bana çalışma planı yap"
Önce gerekirse:
- get_self_exam_results(limit=3)
- get_self_assignments(status="pending")
Sonra:
- create_study_plan(...)

### "Bana mini quiz hazırla"
- generate_quiz(...)

## Yapmaması Gerekenler
- Tüm okul verisini istemek
- Başka öğrencilerin verisini istemek
- Ham tool sonucunu açıklamasız paylaşmak
- Yetki dışı veri istemek
