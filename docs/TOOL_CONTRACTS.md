# TOOL CONTRACTS

Bu doküman, eğitim AI mimarisindeki tool'ların ortak sözleşmesini tanımlar.

## Genel kurallar
- Tüm tool çağrıları auth context ile çalışır.
- Agent yalnızca izinli tool'ları çağırabilir.
- Tool input içindeki kimlik alanları backend tarafından doğrulanır.
- Hiçbir tool sınırsız veri dökümü yapmaz.
- Tüm liste tool'larında limit, page veya cursor mantığı bulunur.
- Tüm tarih filtreleri ISO-8601 formatında olmalıdır.
- Tüm tool sonuçları normalize edilmiş JSON döner.
- Tüm tool çağrıları audit log'a yazılır.

## Öğrenci Tool'ları
- get_self_profile: Öğrencinin profilini getirir
- get_self_exam_results: Sınav sonuçları (subject, limit, date_range)
- get_self_outcome_breakdown: Kazanım bazlı performans (subject, exam_ids)
- get_self_assignments: Ödevler (status, limit)
- create_self_study_plan: Çalışma planı (subject, goal, available_days, daily_minutes)

## Öğretmen Tool'ları
- list_teacher_classes: Sınıf listesi
- list_class_students: Sınıf öğrencileri (class_id, page, limit)
- get_student_exam_results: Öğrenci sınav sonuçları (student_id, subject, limit, date_range)
- get_class_exam_results: Sınıf sınav sonuçları (class_id, subject, exam_id, limit)
- get_class_outcome_breakdown: Sınıf kazanım kırılımı (class_id, subject, exam_id)
- generate_exam: Sınav üretimi (grade_level, subject, topics, question_count, difficulty)
- generate_homework: Ödev üretimi (class_id, subject, topics, question_count)

## Veli Tool'ları
- list_my_children: Çocuk listesi
- get_child_exam_results: Çocuk sınav sonuçları (child_id, limit, date_range)
- get_child_assignments: Çocuk ödevleri (child_id, status, limit)
- get_child_attendance: Devamsızlık (child_id, period)
- generate_parent_report: Veli raporu (child_id, period)

## Uzman Alt-Agent Tool Kullanım Haritası
- retrieval-agent: Tüm okuma tool'ları
- assessment-agent: exam_results + outcome_breakdown tool'ları
- study-plan-agent: exam_results + assignments + create_study_plan
- content-agent: generate_exam + generate_homework
- report-agent: child verileri + generate_parent_report
- risk-agent: class/student exam + attendance tool'ları

## Backend Kontrol Kuralları
- JWT/session doğrulama
- role doğrulama
- scope doğrulama
- limit üst sınırı (max 50)
- tarih aralığı max 1 yıl
- audit log
