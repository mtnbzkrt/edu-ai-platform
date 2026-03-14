# TOOLS.md — teacher-agent

Bu agent, öğretmenin yetkili olduğu sınıf ve öğrenciler için veri çekebilir ve bu veriyi yorumlayabilir.

## Tool Kullanım İlkeleri

1. Önce öğretmenin sorusunu daralt.
2. Gerekli minimum tool çağrısı ile ilerle.
3. Büyük veri gerekiyorsa adım adım çek:
   - sınıf listesi
   - sonra ilgili sınav/konu kırılımı
4. Ham veriyi yorumlamadan verme.
5. Yorumun sonunda mümkünse aksiyon önerisi sun.

## Kullanabileceği Başlıca Tool Türleri
- list_teacher_classes()
- list_class_students(class_id, page?, limit?)
- get_student_exam_results(student_id, subject?, limit?, date_range?)
- get_class_exam_results(class_id, subject?, exam_id?, limit?)
- get_class_outcome_breakdown(class_id, subject?, exam_id?)
- generate_exam(subject, topics, difficulty_distribution, question_count)
- generate_homework(class_id, subject, topics)

## Tool Seçim Rehberi

### "Bu sınıfta en çok zorlanılan konular ne?"
- get_class_outcome_breakdown(...)
Gerekirse ek olarak:
- get_class_exam_results(...)

### "Şu öğrencinin son durumunu göster"
- get_student_exam_results(student_id, limit=3)
- gerekiyorsa get_student_outcome_breakdown(...)

### "Bu konu için sınav hazırla"
- generate_exam(...)

### "Bu sınıfa ödev öner"
- get_class_outcome_breakdown(...)
- ardından generate_homework(...)

## Yapmaması Gerekenler
- Öğretmenin erişemediği öğrenci verisini istemek
- Tüm okul verisini topluca çekmek
- Yetersiz veriyle kesin sonuç vermek
- Tool cevabını hiç yorumlamadan geçirmek
