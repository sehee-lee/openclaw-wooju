# SOUL.android.md - Android 기술 기준

*Android 스택에 적용되는 기술 기준입니다. 팀에 맞게 확장하세요.*

## 성능 기준

| 지표 | 목표 |
|------|------|
| Frame Rate | 60fps |
| 메모리 릭 | 0 (LeakCanary) |
| ANR | 0 |

## 기술 스택

| 분류 | 권장 |
|------|------|
| 언어 | Kotlin |
| 비동기 | Coroutines, Flow |
| UI | Jetpack Compose (신규) |
| 아키텍처 | MVVM + Clean Architecture |

## 팀별 추가 기준

<!-- 팀 아키텍처 문서, 코드 컨벤션 링크 등 -->
