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

## 첫 npm 배포 (0.1.0)

npm은 패키지가 먼저 있어야 trusted publisher를 등록할 수 있다(확인 필요). 그래서 첫 배포만 단기 토큰을 쓴다.

1. 짧은 기간짜리 granular 토큰을 만들어 `release` 환경의 secret `NPM_TOKEN`으로 넣는다.
2. `v0.1.0` 태그를 push하면 release.yml이 `npm publish --provenance --access public`으로 배포한다.
3. npm 패키지 설정에서 trusted publisher를 등록한다(저장소 hall7024/korea-realestate-mcp, workflow release.yml, environment release).
4. "Require 2FA and disallow tokens"를 켠다.
5. 토큰을 폐기하고 secret을 지운다. 이후 배포는 OIDC로만 한다.

## 배포 후

- [ ] `npx -y korea-realestate-mcp@0.1 doctor`로 동작을 확인한다
- [ ] MCP 레지스트리에 등록한다: `mcp-publisher login github`, 이어서 `mcp-publisher publish`. `server.json`과 package.json의 버전, `mcpName`이 맞아야 한다
- [ ] 공공데이터포털에서 미신청 8종을 활용신청하고, 그 서비스들의 실측 fixture를 채워 `verified`를 갱신한다
