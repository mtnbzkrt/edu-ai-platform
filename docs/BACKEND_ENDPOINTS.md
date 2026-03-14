# BACKEND ENDPOINT DESIGN

## Katmanlar
Client/Web/Mobile -> School App API -> AI Orchestrator/Session API -> OpenClaw -> Tool API -> School Connector -> School Main Software/LMS/DB

## Auth modeli
- Kullanıcı auth: JWT ile role, user_id, school_id, permissions
- Tool API auth: Internal service token + Signed context JWT

## Ortak endpoint kuralları
- Tüm tool endpoint'leri POST
- Prefix: POST /api/ai/tools/...
- Ortak request envelope: { input: {}, meta: { request_id, agent, tool } }
- Ortak response envelope: { ok: true, data: {}, meta: { source, fetched_at, request_id } }

## Öğrenci Endpoint'leri
- POST /api/ai/tools/get-self-profile
- POST /api/ai/tools/get-self-exam-results
- POST /api/ai/tools/get-self-outcome-breakdown
- POST /api/ai/tools/get-self-assignments
- POST /api/ai/tools/create-self-study-plan

## Öğretmen Endpoint'leri
- POST /api/ai/tools/list-teacher-classes
- POST /api/ai/tools/list-class-students
- POST /api/ai/tools/get-student-exam-results
- POST /api/ai/tools/get-class-exam-results
- POST /api/ai/tools/get-class-outcome-breakdown
- POST /api/ai/tools/generate-exam
- POST /api/ai/tools/generate-homework

## Veli Endpoint'leri
- POST /api/ai/tools/list-my-children
- POST /api/ai/tools/get-child-exam-results
- POST /api/ai/tools/get-child-assignments
- POST /api/ai/tools/get-child-attendance
- POST /api/ai/tools/generate-parent-report

## Sistem Endpoint'leri
- POST /api/ai/sessions (yeni session)
- POST /api/ai/chat (mesaj gönder)
- GET /api/ai/sessions/:id (session durumu)

## Rate limit
- limit <= 50
- tarih max 365 gün
- sınıf max 100 kayıt
- timeout 10 saniye
- session başına saniyede max 3 tool çağrısı
