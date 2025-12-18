# AGENTS.md

## Branches & deploy
- staging -> staging.search.iirest.ru
- main -> search.iirest.ru

## Rules
- Never commit secrets. `.env` is server-only. Only `.env.example` is allowed in the repo.
- Work only via PRs (no direct pushes to main/staging).
- Keep `/health` stable.
- Keep changes small and focused.

## Current Context (Active Memory)
- **Primary Goal:** Создать удобный и правильный сервис сравнения цен (раздел "Тендеры").
- **Secondary Goal:** Улучшение дизайна (UI/UX) и обновление логотипа.
- **Key Focus Area:** Логика и интерфейс страницы `templates/tender_project.html`.
- **Requirements:** Сравнение должно быть математически корректным (учет единиц измерения, веса, базовой цены) и визуально понятным пользователю.
