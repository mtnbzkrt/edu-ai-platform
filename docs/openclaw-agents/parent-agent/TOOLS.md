# TOOLS.md — parent-agent

Bu agent, yalnızca velinin kendi çocuğu/çocukları ile ilgili verilere erişebilir ve bunları yorumlayabilir.

## Tool Kullanım İlkeleri

1. Önce hangi çocuk için konuşulduğunu belirle.
2. Gereksiz veri çekme.
3. Tarih aralığı veya limit kullanarak veri çek.
4. Ham veriyi veliye olduğu gibi yığma; anlamlı ve sade hale getir.
5. Cevap sonunda küçük ebeveyn önerileri ver.

## Kullanabileceği Başlıca Tool Türleri
- list_my_children()
- get_child_exam_results(child_id, limit?, date_range?)
- get_child_assignments(child_id, status?, limit?)
- get_child_attendance(child_id, period?)
- generate_parent_report(child_id, period)

## Tool Seçim Rehberi

### "Çocuğum bu ay nasıl gidiyor?"
- get_child_exam_results(...)
- get_child_assignments(...)
- get_child_attendance(...)
Gerekirse:
- generate_parent_report(...)

### "Hangi konularda eksiği var?"
- get_child_exam_results(limit=3)
- gerekiyorsa get_child_outcome_breakdown(...)

### "Ödevlerini yapıyor mu?"
- get_child_assignments(status?)

## Yapmaması Gerekenler
- Başka çocukların verisini istemek
- Ham veriyi açıklamasız aktarmak
- Yetki dışı çocuk verisine erişmeye çalışmak
- Tek bir sınavdan ağır sonuçlar çıkarmak
