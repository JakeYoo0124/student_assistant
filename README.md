# M.B.A (Megazone Bootcamp Agent)

부트캠프 출결 신청·승인 웹 앱. 학생이 결석·휴가를 신청하면 담당자가 승인하고, 학생은 승인 후 기한 안에 증빙서류를 올립니다.

## 폴더 구조

```
backend/    FastAPI 서버 (Python), DB(SQLite), 업로드 파일
frontend/   화면 (HTML / CSS / JavaScript) — 서버가 /static 으로 내려줌
```

## 처음 한 번만

```bash
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1        # PowerShell. 켜지면 프롬프트 앞에 (.venv)가 붙는다
pip install -r requirements.txt
python create_manager.py          # 첫 담당자 계정 만들기
python seed_dummy.py              # (선택) 과정별 더미 학생 15명씩
```

## 서버 켜기

```bash
cd backend
.venv\Scripts\Activate.ps1
uvicorn main:app --reload --port 8002
```

브라우저에서 http://127.0.0.1:8002 로 접속합니다. 터미널을 새로 열 때마다 가상환경을 다시 켜야 합니다.

더미 학생 로그인: `ai01@example.com` ~ `ai15@example.com`, `arch01`~`arch15`, `sec01`~`sec15` / 비밀번호 `dummy1234`

## 배포 전에

- 환경변수 `SECRET_KEY` 를 긴 무작위 값으로 설정 (지금 코드의 기본값은 개발용)
- `backend/database.db`, `backend/uploads/` 는 GitHub에 올라가지 않는다 (`.gitignore`)
