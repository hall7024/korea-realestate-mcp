# 공개·배포 체크리스트

저장소 생성, 공개, 배포는 되돌리기 어려우니 항목마다 사용자가 확인한 뒤 진행한다.

## 공개 전 (push 전)

- [ ] 커밋 작성자 이메일 결정. 지금은 개인 Gmail이다. 공개한 뒤에는 되돌릴 수 없다. 바꾸려면 push 전에 GitHub noreply 주소(`<id>+hall7024@users.noreply.github.com`)로 이력을 다시 쓴다.
- [ ] SECURITY.md의 응답 약속 문구 확인
- [ ] GitHub·npm 계정의 2FA(패스키·보안 키) 확인

## 저장소 생성 (hall7024/korea-realestate-mcp)

- [ ] 공개 저장소를 만들고 `main`과 `feat/v0.1`을 push한다. PR로 병합한다.
- [ ] Settings → Code security
  - [ ] Private vulnerability reporting 켜기 (개인 저장소는 기본으로 꺼져 있음)
  - [ ] Secret scanning과 push protection 확인
  - [ ] Dependabot alerts와 security updates 켜기
  - [ ] CodeQL은 `.github/workflows/codeql.yml`로 돌린다. 기본 설정(default setup)은 쓰지 않는다
- [ ] Settings → Actions: Workflow permissions를 "Read repository contents"로 둔다
- [ ] Rulesets(main): force push와 삭제를 막고, 상태 확인 `test`, `gitleaks`, `semgrep`, `zizmor`를 필수로 한다
- [ ] Settings → Environments: `release` 환경을 만든다. 배포는 태그로만 한다
- [ ] Releases: immutable releases 켜기
- [ ] 첫 CI 실행 결과 확인. semgrep(pipx) 단계가 정상으로 도는지 본다

## npm 배포

- 0.1.0만 단기 토큰으로 CI에서 배포했다(2026-11-13). 그 뒤 trusted publisher(hall7024/korea-realestate-mcp, release.yml, environment release)를 등록하고, 토큰 게시를 막고, 토큰을 폐기했다.
- 이후 버전: package.json·server.json·CHANGELOG 버전을 올리고 커밋한 뒤 `v<버전>` 태그를 push한다. release.yml이 OIDC로 npm에 배포하고, 이어서 MCP 레지스트리에도 GitHub OIDC로 등록한다.

## 배포 후

- [ ] `npx -y korea-realestate-mcp@0.1 doctor`로 동작을 확인한다
