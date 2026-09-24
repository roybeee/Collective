"""설치기(server/research-worker/install.py)의 순수 함수 검사. root·네트워크 없이 실행한다."""
import contextlib
import importlib.util
import io
import ipaddress
import json
import os
import pwd
import re
import signal
import stat
import subprocess
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

SOURCE = Path(__file__).parents[1] / 'server/research-worker/install.py'
spec = importlib.util.spec_from_file_location('installer', SOURCE)
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)

PRIVATE = ('127.0.0.0/8', '169.254.0.0/16', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '::1/128', 'fc00::/7', 'fe80::/10')
CHROME = Path('/opt/collective-browser/chromium/chrome')

def account(name, uid, gid):
    return pwd.struct_passwd((name, 'x', uid, gid, '', '/var/lib/' + name, '/usr/sbin/nologin'))

class FirewallTest(unittest.TestCase):
    def test_rules_block_every_internal_range_for_browser_uid_only(self):
        rules = installer.nft_rules(991)
        for network in PRIVATE + ('0.0.0.0/8', '100.64.0.0/10', '::/128'):
            self.assertIn(network, rules)
        self.assertIn('meta skuid 991 jump browser', rules)
        self.assertEqual(rules.count('jump browser'), 1)
        self.assertLess(rules.index('chain browser'), rules.index('jump browser'))
        browser_chain = rules.split('chain browser')[1]
        self.assertLess(browser_chain.index('ct state established,related accept'), browser_chain.index('reject'))
        # 선언→삭제→정의 순서로 이 테이블만 교체한다(다른 방화벽 규칙은 건드리지 않음).
        self.assertTrue(rules.startswith('table inet collective_browser\ndelete table inet collective_browser\n'))
        self.assertNotIn('flush ruleset', rules)
    def test_shorthand_ranges_expand_to_valid_networks(self):
        self.assertEqual(installer.expand_cidr('172.16/12'), '172.16.0.0/12')
        self.assertEqual(installer.expand_cidr('10/8'), '10.0.0.0/8')
        for short in installer.BLOCKED_V4:
            ipaddress.ip_network(installer.expand_cidr(short))
    def test_only_resolvers_inside_blocked_ranges_get_a_dns_exception(self):
        resolv = '# comment\nnameserver 127.0.0.53\nnameserver 1.1.1.1\nnameserver fe80::1%eth0\noptions edns0\nnameserver bogus\n'
        found = installer.dns_exceptions(resolv)
        self.assertEqual([str(x) for x in found], ['127.0.0.53', 'fe80::1'])
        rules = installer.nft_rules(991, found)
        dns = 'ip daddr 127.0.0.53 meta l4proto { tcp, udp } th dport 53 accept'
        self.assertIn(dns, rules)
        self.assertIn('ip6 daddr fe80::1 meta l4proto { tcp, udp } th dport 53 accept', rules)
        self.assertLess(rules.index(dns), rules.index('reject'))
        self.assertNotIn('1.1.1.1', rules)
    def test_host_own_broadcast_and_multicast_addresses_rejected_after_exceptions(self):
        # 서버 자신의 공인 주소로 가는 연결은 lo를 타므로 대역 목록만으로는 막히지 않는다.
        rules = installer.nft_rules(991, installer.dns_exceptions('nameserver 127.0.0.53\n'))
        chain = rules.split('chain browser')[1].split('chain output')[0]
        rule = 'fib daddr type { local, broadcast, multicast } reject'
        self.assertIn(rule, chain)
        self.assertLess(chain.index('ct state established,related accept'), chain.index(rule))
        self.assertLess(chain.index('th dport 53 accept'), chain.index(rule))
        self.assertLess(chain.index(rule), chain.index('ip daddr {'))
    def test_cdp_port_only_accepts_listed_local_accounts(self):
        rules = installer.nft_rules(991, cdp_clients=(0, 1000))
        output = rules.split('chain output')[1]
        port = str(installer.CDP_PORT)
        self.assertIn('ip daddr 127.0.0.0/8 tcp dport ' + port + ' meta skuid != { 0, 1000 } reject', output)
        self.assertIn('ip6 daddr ::1 tcp dport ' + port + ' meta skuid != { 0, 1000 } reject', output)
        self.assertNotIn('dport ' + port, installer.nft_rules(991))
    def test_probe_port_only_accepts_root(self):
        # 설치 점검 때 여는 CDP 점검 포트도 인증이 없다. hermes를 포함해 root 밖의 계정은 새로 연결하지 못한다.
        port = str(installer.PROBE_PORT)
        for rules in (installer.nft_rules(991), installer.nft_rules(991, cdp_clients=(0, 1000))):
            output = rules.split('chain output')[1]
            self.assertIn('ip daddr 127.0.0.0/8 tcp dport ' + port + ' meta skuid != 0 reject', output)
            self.assertIn('ip6 daddr ::1 tcp dport ' + port + ' meta skuid != 0 reject', output)
            self.assertEqual(rules.count('dport ' + port), 2)
            self.assertLess(output.index('jump browser'), output.index('dport ' + port))
    def test_route_source_reads_default_route_address(self):
        v4 = '192.0.2.1 via 198.51.100.1 dev eth0 src 203.0.113.10 uid 0 \\    cache '
        v6 = '2001:db8::1 from :: via fe80::1 dev eth0 proto ra src 2001:db8:0:1::10 metric 1024 pref medium'
        self.assertEqual(installer.route_source(v4), '203.0.113.10')
        self.assertEqual(installer.route_source(v6), '2001:db8:0:1::10')
        self.assertIsNone(installer.route_source(''))
        self.assertIsNone(installer.route_source('RTNETLINK answers: Network is unreachable'))
    def test_listener_uids_reads_listening_sockets_on_cdp_port(self):
        table = ('  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n'
                 '   0: 0100007F:2475 00000000:0000 0A 00000000:00000000 00:00000000 00000000   991        0 1 1 0\n'
                 '   1: 0100007F:2475 0100007F:9C40 01 00000000:00000000 00:00000000 00000000   991        0 2 1 0\n'
                 '   2: 00000000:0016 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 3 1 0\n')
        self.assertEqual(installer.listener_uids(table, installer.CDP_PORT), {991})
        squatted = table + '   3: 0100007F:2475 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1001        0 4 1 0\n'
        self.assertEqual(installer.listener_uids(squatted, installer.CDP_PORT), {991, 1001})
        self.assertEqual(installer.listener_uids(table, 9222), set())

class BrowserServiceTest(unittest.TestCase):
    def test_unit_runs_chromium_as_browser_user_with_sandbox(self):
        unit = installer.browser_unit(CHROME)
        self.assertIn('\nUser=collective-browser\n', unit)
        self.assertNotIn('User=hermes', unit)
        self.assertNotIn('--no-sandbox', unit)
        self.assertIn('ExecStart=' + str(CHROME) + ' ', unit)
        self.assertIn('--remote-debugging-port=' + str(installer.CDP_PORT), unit)
        self.assertNotIn('remote-debugging-address', unit)
        # 방화벽 유닛이 멈추거나 비활성이 되면 브라우저도 멈춘다.
        self.assertIn('BindsTo=' + installer.FIREWALL_SERVICE, unit)
        self.assertIn('After=' + installer.FIREWALL_SERVICE, unit)
        for line in ('ProtectHome=true', 'ProtectSystem=strict', 'PrivateTmp=true'):
            self.assertIn(line, unit)
    def test_no_sandbox_only_with_explicit_exception(self):
        self.assertIn('--no-sandbox', installer.browser_unit(CHROME, no_sandbox=True))
        self.assertNotIn('--no-sandbox', installer.chrome_flags())
    def test_firewall_unit_replaces_only_its_own_table(self):
        unit = installer.firewall_unit()
        self.assertIn('ExecStart=/usr/sbin/nft -f ' + str(installer.NFT_RULES), unit)
        self.assertIn('ExecStop=/usr/sbin/nft delete table inet collective_browser', unit)
        self.assertIn('Before=' + installer.BROWSER_SERVICE, unit)
        # nftables.service를 다시 읽거나 재시작하면(flush ruleset) 이 테이블도 다시 넣는다.
        for line in ('After=nftables.service', 'PartOf=nftables.service', 'ReloadPropagatedFrom=nftables.service',
                     'ExecReload=/usr/sbin/nft -f ' + str(installer.NFT_RULES)):
            self.assertIn(line, unit)
    def test_apparmor_profile_grants_userns_to_the_installed_chromium_only(self):
        profile = installer.apparmor_profile(CHROME)
        self.assertIn('profile collective-chromium ' + str(CHROME) + ' flags=(unconfined) {', profile)
        self.assertIn('  userns,\n', profile)
        self.assertIn('abi <abi/4.0>,', profile)
    def test_sandbox_failure_stops_install_unless_explicitly_allowed(self):
        self.assertFalse(installer.sandbox_decision(False, None, False))
        self.assertFalse(installer.sandbox_decision(True, None, False))
        with self.assertRaises(RuntimeError) as error:
            installer.sandbox_decision(True, 'apparmor_parser failed', False)
        self.assertIn('--allow-no-sandbox', str(error.exception))
        self.assertIn('apparmor_parser failed', str(error.exception))
        self.assertTrue(installer.sandbox_decision(True, 'apparmor_parser failed', True))
    def test_chrome_policy_blocks_local_files_and_internal_pages(self):
        blocked = json.loads(installer.chrome_policy())['URLBlocklist']
        for pattern in ('file://*', 'chrome://*'):
            self.assertIn(pattern, blocked)
        self.assertFalse(any(x.startswith(('about:', 'data:', 'blob:', 'http')) for x in blocked))
    def test_file_policy_needs_positive_evidence_that_chromium_still_works(self):
        # 입력: file 제목 노출 여부, 직후 data: 재확인 성공 여부.
        self.assertEqual(installer.policy_problem(False, True), '')
        # 시간 초과·비정상 종료로 제목이 안 보인 것만으로는 정책 차단의 증거가 아니다.
        self.assertIn('재확인', installer.policy_problem(False, False))
        self.assertIn('URLBlocklist', installer.policy_problem(True, True))
        self.assertIn('URLBlocklist', installer.policy_problem(True, False))
    def test_smoke_check_attaches_with_cdp_only_like_hermes(self):
        ws = 'ws://127.0.0.1:' + str(installer.CDP_PORT) + '/devtools/browser/abc'
        command = installer.smoke_command(['runuser', '-u', 'hermes', '--', 'env'], ws)
        self.assertNotIn('--session', command)
        self.assertEqual(command[-2:], ['--cdp', ws])
        self.assertEqual(command[-3], str(installer.PREFIX / 'node_modules/.bin/agent-browser'))
    def test_positive_control_finds_opened_page_in_isolated_browser(self):
        targets = [{'type': 'page', 'url': 'about:blank'}, {'type': 'page', 'url': 'https://example.com/'}]
        self.assertTrue(installer.has_page(targets, 'https://example.com'))
        self.assertFalse(installer.has_page([{'type': 'service_worker', 'url': 'https://example.com/'}], 'https://example.com'))
        self.assertFalse(installer.has_page([{'type': 'page', 'url': 'about:blank'}, 'bogus'], 'https://example.com'))
    def test_cdp_websocket_must_be_the_loopback_browser_endpoint(self):
        self.assertTrue(installer.loopback_websocket('ws://127.0.0.1:' + str(installer.CDP_PORT) + '/devtools/browser/abc'))
        self.assertFalse(installer.loopback_websocket('ws://127.0.0.1:9222/devtools/browser/abc'))
        self.assertFalse(installer.loopback_websocket('ws://evil.example/devtools/browser/abc'))

class HermesSettingsTest(unittest.TestCase):
    def test_hermes_attaches_to_isolated_browser_without_disabling_sandbox(self):
        block = installer.hermes_env_block('20260923')
        dropin = installer.hermes_dropin(Path('/home/hermes'))
        for text in (block, dropin):
            self.assertNotIn('--no-sandbox', text)
            self.assertIn('BROWSER_CDP_URL', text)
            self.assertIn('http://127.0.0.1:' + str(installer.CDP_PORT), text)
            # 값이 있으면 HERMES가 userns 제한 환경에서 --no-sandbox를 자동으로 넣지 않는다.
            self.assertIn('AGENT_BROWSER_ARGS', text)
        self.assertIn('BROWSER_CDP_URL="http://127.0.0.1:' + str(installer.CDP_PORT) + '"\n', block)
        self.assertIn('AGENT_BROWSER_CDP_URL=""\n', block)
        self.assertIn(str(installer.PREFIX / 'node_modules/.bin'), dropin)
        self.assertNotIn('UnsetEnvironment=BROWSER_CDP_URL', dropin)
        # 이전 설치가 넣은 hermes 소유 Chromium 경로가 로컬 실행 경로로 되살아나지 않게 비운다.
        self.assertIn('AGENT_BROWSER_EXECUTABLE_PATH=""\n', block)
        self.assertIn('AGENT_BROWSER_EXECUTABLE_PATH', dropin.split('UnsetEnvironment=')[1])
    def test_raw_browser_tools_blocked_by_fail_closed_pre_tool_call_hook(self):
        other = {'matcher': 'terminal', 'command': '/home/hermes/.hermes/agent-hooks/scan.sh'}
        existing = {'pre_tool_call': [other, {'command': str(installer.HOOK_SCRIPT)}], 'post_tool_call': [{'command': '/x'}]}
        hooks = installer.hermes_hooks(existing)
        entry = {'matcher': installer.RAW_TOOL_MATCHER, 'command': str(installer.HOOK_SCRIPT), 'timeout': 5, 'fail_closed': True}
        self.assertEqual(hooks['pre_tool_call'], [other, entry])
        self.assertEqual(hooks['post_tool_call'], [{'command': '/x'}])
        self.assertEqual(installer.hermes_hooks(hooks), hooks)
        self.assertEqual(len(existing['pre_tool_call']), 2)
        self.assertEqual(installer.hermes_hooks(None), {'pre_tool_call': [entry]})
        self.assertEqual(installer.hermes_hooks('bogus'), {'pre_tool_call': [entry]})
        # HERMES는 fullmatch를 쓰지만 앵커가 있어 search·match로 읽어도 두 도구만 맞는다.
        for match in (re.fullmatch, re.search, re.match):
            for name in ('browser_cdp', 'browser_dialog'):
                self.assertTrue(match(installer.RAW_TOOL_MATCHER, name), name)
            for name in ('browser_navigate', 'browser_console', 'browser_cdp_x', 'xbrowser_dialog', 'terminal'):
                self.assertFalse(match(installer.RAW_TOOL_MATCHER, name), name)
    def test_hook_script_blocks_with_exit_code_2_and_reason(self):
        with tempfile.TemporaryDirectory() as folder:
            script = Path(folder) / 'deny.sh'
            script.write_text(installer.hook_script())
            os.chmod(script, 0o755)
            result = subprocess.run([str(script)], input='{"tool_name":"browser_cdp"}', capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 2)
        self.assertIn('browser_cdp', result.stderr)
        self.assertEqual(result.stdout, '')
    def test_allowlist_approves_only_the_exact_hook(self):
        command = str(installer.HOOK_SCRIPT)
        ours = {'event': 'pre_tool_call', 'command': command, 'approved_at': '2026-09-24T00:00:00Z'}
        before = '{"approvals": [{"event": "post_llm_call", "command": "/x"}, {"event": "pre_tool_call", "command": "' + command + '"}], "note": 1}'
        data = json.loads(installer.hook_allowlist(before, ours['approved_at']))
        self.assertEqual(data['approvals'], [{'event': 'post_llm_call', 'command': '/x'}, ours])
        self.assertEqual(data['note'], 1)
        for broken in (None, b'', b'not json', b'[]', b'{"approvals": "x"}'):
            self.assertEqual(json.loads(installer.hook_allowlist(broken, ours['approved_at']))['approvals'], [ours])
    def test_installed_hermes_must_support_fail_closed_shell_hooks(self):
        shell = 'VALID pre_tool_call ... fail_closed ... ALLOWLIST_FILENAME = "shell-hooks-allowlist.json"'
        gateway = 'from agent.shell_hooks import register_from_config'
        self.assertEqual(installer.hook_support_missing(shell, gateway), [])
        self.assertTrue(installer.hook_support_missing(shell.replace('fail_closed', ''), gateway))
        self.assertTrue(installer.hook_support_missing(shell, ''))
        self.assertTrue(installer.hook_support_missing('', gateway))
    def test_hook_check_reads_hermes_cli_output(self):
        command = str(installer.HOOK_SCRIPT)
        listed = 'Configured shell hooks (1 total):\n\n  [pre_tool_call]\n    - ' + command + " matcher='x' (timeout=5s, \u2713 allowed)\n"
        blocked = ("Firing 1 hook(s) for event 'pre_tool_call':\n\n  \u2192 " + command + '\n      exit=2  elapsed=0.01s\n'
                   '      parsed (Hermes wire shape): {"action": "block", "message": "no"}\n')
        allowed = 'No shell hooks configured for event: pre_tool_call\n(with matcher filter --for-tool=browser_navigate)\n'
        self.assertEqual(installer.hook_check_problem(command, listed, blocked, allowed), '')
        self.assertTrue(installer.hook_check_problem(command, listed.replace('\u2713 allowed', '\u2717 not allowlisted'), blocked, allowed))
        self.assertTrue(installer.hook_check_problem(command, listed, blocked.replace('"block"', '"allow"'), allowed))
        other = "  \u2192 /other.sh\n      parsed (Hermes wire shape): {\"action\": \"block\"}\n"
        self.assertTrue(installer.hook_check_problem(command, listed, "  \u2192 " + command + '\n      parsed: <none>\n' + other, allowed))
        self.assertTrue(installer.hook_check_problem(command, listed, blocked, blocked))

class IsolationCheckTest(unittest.TestCase):
    def test_file_denials_run_as_browser_user_against_secrets(self):
        worker = Path('/etc/collective-research/worker.json')
        checks = installer.file_denials(worker, Path('/home/hermes/.hermes'))
        paths = [path for _, path, _ in checks]
        self.assertEqual(paths, [worker, Path('/home/hermes/.hermes/config.yaml'), Path('/home/hermes/.hermes/.env')])
        for _, path, command in checks:
            self.assertEqual(command[:4], ['runuser', '-u', 'collective-browser', '--'])
            self.assertEqual(command[-1], str(path))
    def test_network_denial_targets_live_loopback_port(self):
        label, command = installer.network_denial()
        self.assertEqual(command[:4], ['runuser', '-u', 'collective-browser', '--'])
        self.assertEqual(command[-2:], ['127.0.0.1', str(installer.CDP_PORT)])
    def test_denial_that_succeeds_stops_install(self):
        allowed = lambda *a, **k: subprocess.CompletedProcess(a, 0)
        denied = lambda *a, **k: subprocess.CompletedProcess(a, 1)
        with self.assertRaises(installer.IsolationError):
            installer.expect_denied('worker.json', ['cat', 'x'], runner=allowed)
        with self.assertRaises(installer.IsolationError) as error:
            installer.expect_denied('worker.json', ['cat', 'x'], runner=allowed, who='hermes 계정')
        self.assertIn('hermes 계정', str(error.exception))
        installer.expect_denied('worker.json', ['cat', 'x'], runner=denied)
        self.assertTrue(issubclass(installer.IsolationError, RuntimeError))
    def test_hermes_cannot_read_worker_credentials(self):
        worker = Path('/etc/collective-research/worker.json')
        label, command = installer.worker_denial(worker, Path('/home/hermes'))
        self.assertEqual(command[:4], ['runuser', '-u', 'hermes', '--'])
        self.assertEqual(command[-2:], ['cat', str(worker)])
        readable = installer.worker_readable(worker)
        self.assertEqual(readable[:4], ['runuser', '-u', installer.WORKER_USER, '--'])
        self.assertEqual(readable[-3:], ['test', '-r', str(worker)])
    def test_other_local_accounts_cannot_reach_cdp_or_host_addresses(self):
        label, command = installer.cdp_client_denial()
        self.assertEqual(command[:4], ['runuser', '-u', installer.NPM_USER, '--'])
        self.assertEqual(command[-2:], ['127.0.0.1', str(installer.CDP_PORT)])
        label, command = installer.host_denial('203.0.113.10', 40000)
        self.assertEqual(command[:4], ['runuser', '-u', installer.BROWSER_USER, '--'])
        self.assertEqual(command[-2:], ['203.0.113.10', '40000'])
    def test_isolation_failure_always_stops_browser_but_functional_failure_restores(self):
        self.assertFalse(installer.keep_browser(installer.IsolationError('x'), True))
        self.assertFalse(installer.keep_browser(RuntimeError('x'), False))
        self.assertTrue(installer.keep_browser(RuntimeError('x'), True))
    def test_dedicated_accounts_must_not_share_root_or_hermes_identity(self):
        hermes = account('hermes', 1000, 1000)
        self.assertEqual(installer.isolation_problems(account('collective-browser', 991, 991), hermes, [991]), [])
        self.assertTrue(installer.isolation_problems(account('collective-browser', 1000, 991), hermes, [991]))
        self.assertTrue(installer.isolation_problems(account('collective-browser', 991, 991), hermes, [991, 1000]))
        self.assertTrue(installer.isolation_problems(account('collective-browser', 991, 991), hermes, [991, 0]))
    def test_other_users_lose_access_to_hermes_directory(self):
        with tempfile.TemporaryDirectory() as folder:
            os.chmod(folder, 0o755)
            installer.without_other_access(Path(folder))
            self.assertEqual(stat.S_IMODE(os.stat(folder).st_mode), 0o750)

def page_title(text):
    return re.search('<title>(.*)</title>', text).group(1)

class FakeProcess:
    def __init__(self, pid, exit_code=None, wait_error=None):
        self.pid, self.exit_code, self.wait_error, self.waits = pid, exit_code, wait_error, 0
    def poll(self):
        return self.exit_code
    def wait(self, timeout=None):
        self.waits += 1
        if self.wait_error and self.waits == 1:
            raise self.wait_error
        return 0

EXPECT_DENIED = installer.expect_denied

class FakeChromium:
    """점검용 Chromium 대역. PUT /json/new로 연 페이지의 제목을 /json/list로 돌려준다(root·네트워크 없음).
    file_open_fails: file:// 요청만 실패, file_late: file 제목이 재확인 때 뒤늦게 보임, probe_denied: 다른 계정의 점검 포트 접속이 막힘,
    leftover: 포트를 잡은 것이 이전 점검 브라우저라 pkill로 끝남, interrupt: file:// 요청 중 이 신호를 받음."""
    def __init__(self, live=lambda command: True, data_pages=2, file_exposed=False, owners=(991,), squatters=(), exit_code=None,
                 file_open_fails=False, file_late=False, probe_denied=True, leftover=False, interrupt=None):
        self.live, self.data_pages, self.file_exposed, self.exit_code = live, data_pages, file_exposed, exit_code
        self.file_open_fails, self.file_late, self.probe_denied, self.leftover, self.interrupt = file_open_fails, file_late, probe_denied, leftover, interrupt
        self.owners, self.squatters = set(owners), set(squatters)
        self.commands, self.popen_kwargs, self.opened, self.titles, self.kills, self.json_calls = [], [], [], [], [], []
        self.denials, self.runs, self.handlers, self.late = [], [], {}, None
        self.running = self.listening = False
        self.page = None
    def popen(self, command, **kwargs):
        self.commands.append(command)
        self.popen_kwargs.append(kwargs)
        self.handlers = {sig: signal.getsignal(sig) for sig in (signal.SIGHUP, signal.SIGTERM)}
        kwargs['stdout'].write(b'[0924/000000.000:FATAL:zygote_host_impl_linux.cc(128)] No usable sandbox!\x1b[0m\n')
        profile = Path(next(x for x in command if x.startswith('--user-data-dir=')).split('=', 1)[1])
        profile.mkdir(parents=True)
        (profile / 'Local State').write_text('{}')
        self.running, self.listening, self.titles = True, self.live(command), []
        return FakeProcess(4000 + len(self.commands), self.exit_code)
    def cdp_json(self, path, base=None):
        self.json_calls.append((base or installer.CDP_URL, path))
        if base != installer.PROBE_URL or not (self.running and self.listening):
            raise ConnectionRefusedError(path)
        if path == '/json/version':
            return {'Browser': 'HeadlessChrome'}
        return [{'type': 'page', 'title': title} for title in ['about:blank'] + self.titles] + ['bogus']
    def cdp_open(self, url, base=None):
        if (base or installer.PROBE_URL) != installer.PROBE_URL or not (self.running and self.listening):
            return False
        self.opened.append(url)
        if url.startswith('data:text/html,') and len([u for u in self.opened if u.startswith('data:')]) <= self.data_pages:
            self.titles += ([self.late] if self.late else []) + [page_title(url)]
        if url.startswith('file://'):
            path = Path(url[len('file://'):])
            self.page = (path, page_title(path.read_text()), stat.S_IMODE(os.stat(path).st_mode))
            if self.interrupt:
                signal.getsignal(self.interrupt)(self.interrupt, None)
            if self.file_open_fails:
                return False
            if self.file_exposed:
                self.titles.append(self.page[1])
            if self.file_late:
                self.late = self.page[1]
        return True
    def listener_uids(self, tables, port):
        assert port == installer.PROBE_PORT
        return set(self.owners) if self.running and self.listening else set(self.squatters)
    def killpg(self, pid, sig):
        self.kills.append((pid, sig))
        self.running = False
    def run(self, command, **kwargs):
        self.runs.append((command, len(self.commands)))
        if command[0] == 'pkill' and self.leftover:
            self.squatters = set()
        return subprocess.CompletedProcess(command, 0)
    def expect_denied(self, label, command, runner=None, who='브라우저 계정'):
        self.denials.append((label, [str(x) for x in command], who, len(self.opened), self.running and self.listening))
        return EXPECT_DENIED(label, command, lambda args, **kwargs: subprocess.CompletedProcess(args, 1 if self.probe_denied else 0), who)

class ProbeChromeTest(unittest.TestCase):
    """3/6단계 Chromium 점검: --dump-dom 대신 점검 포트의 CDP로 양성·음성·재확인을 본다(mocked)."""
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.prefix, self.home = Path(folder.name) / 'opt', Path(folder.name) / 'home'
        self.home.mkdir()
    def run_probe(self, fake, no_sandbox=False, allow=False):
        real_atomic, sleeps, out, err = installer.atomic, [], io.StringIO(), io.StringIO()
        with contextlib.ExitStack() as stack:
            for target, name, value in ((installer, 'PREFIX', self.prefix), (installer, 'BROWSER_HOME', self.home),
                                        (installer, 'atomic', lambda path, data, uid=0, gid=0, mode=0o600: real_atomic(path, data, os.getuid(), os.getgid(), mode)),
                                        (installer.subprocess, 'Popen', fake.popen), (installer, 'cdp_json', fake.cdp_json),
                                        (installer, 'cdp_open', fake.cdp_open), (installer, 'listener_uids', fake.listener_uids),
                                        (installer.os, 'killpg', fake.killpg), (installer.time, 'sleep', sleeps.append),
                                        (installer.subprocess, 'run', fake.run), (installer, 'expect_denied', fake.expect_denied)):
                stack.enter_context(mock.patch.object(target, name, value))
            stack.enter_context(contextlib.redirect_stdout(out))
            stack.enter_context(contextlib.redirect_stderr(err))
            try:
                return installer.probe_chrome(no_sandbox, allow, 991)
            finally:
                self.sleeps, self.out, self.err = sleeps, out.getvalue(), err.getvalue()
    def assert_cleaned(self, fake):
        # 어떤 경로든 띄운 점검 브라우저는 프로세스 그룹째 TERM 뒤 KILL로 끝내고, 프로필·점검 페이지·로그를 지운다.
        pids = [4001 + i for i in range(len(fake.commands))]
        self.assertEqual(fake.kills, [(pid, sig) for pid in pids for sig in (signal.SIGTERM, signal.SIGKILL)])
        self.assertFalse((self.home / 'install-probe').exists())
        self.assertEqual(list((self.prefix / 'policy-check').iterdir()), [])
        self.assertTrue(all(base == installer.PROBE_URL for base, _ in fake.json_calls))
    def test_positive_negative_and_recheck_pass_over_cdp(self):
        fake = FakeChromium()
        self.assertFalse(self.run_probe(fake))
        self.assertEqual(len(fake.commands), 1)
        command, kwargs = fake.commands[0], fake.popen_kwargs[0]
        self.assertEqual(command[:4], ['runuser', '-u', installer.BROWSER_USER, '--'])
        start = command.index(str(installer.CHROME))
        self.assertEqual(command[start + 1:], installer.chrome_flags() + ['--remote-debugging-port=' + str(installer.PROBE_PORT),
                                                                       '--user-data-dir=' + str(self.home / 'install-probe'), 'about:blank'])
        self.assertFalse(any('dump-dom' in x or 'no-sandbox' in x for x in command))
        self.assertTrue(kwargs['start_new_session'])
        self.assertEqual(kwargs['stderr'], subprocess.STDOUT)
        # 양성 data: → 음성 file:// → 새 토큰 data: 재확인. 세 제목은 모두 달라야 앞 페이지가 재확인을 대신하지 못한다.
        self.assertEqual(len(fake.opened), 3)
        first, page, recheck = fake.opened
        self.assertTrue(first.startswith('data:text/html,<title>') and recheck.startswith('data:text/html,<title>'))
        self.assertEqual(page, fake.page[0].as_uri())
        self.assertEqual(fake.page[0], self.prefix / 'policy-check' / 'policy-check.html')
        self.assertEqual(fake.page[2], 0o644)
        self.assertEqual(len({page_title(first), fake.page[1], page_title(recheck)}), 3)
        self.assertIn('격리 확인: 브라우저 계정의 file:// 열기 거부됨', self.out)
        self.assertNotEqual(installer.PROBE_PORT, installer.CDP_PORT)
        self.assert_cleaned(fake)
    def test_cdp_port_never_opening_is_a_sandbox_failure_with_the_real_cause(self):
        fake = FakeChromium(live=lambda command: False)
        with self.assertRaises(installer.IsolationError) as error:
            self.run_probe(fake)
        message = str(error.exception)
        for text in ('샌드박스를 켠 채로 Chromium을 시작하지 못해', 'CDP 점검 포트', str(installer.PROBE_PORT), 'No usable sandbox!',
                     'AppArmor', 'journalctl -k', '--allow-no-sandbox'):
            self.assertIn(text, message)
        self.assertNotIn('\x1b', message)
        self.assertEqual(len(fake.commands), 1)
        # 약 30초 폴링: 1초 간격 30번을 넘지 않는다.
        self.assertLessEqual(len(self.sleeps), 30)
        self.assertGreaterEqual(len(self.sleeps), 25)
        self.assert_cleaned(fake)
    def test_chromium_exiting_early_stops_waiting(self):
        fake = FakeChromium(live=lambda command: False, exit_code=1)
        with self.assertRaises(installer.IsolationError):
            self.run_probe(fake)
        self.assertEqual(self.sleeps, [])
        self.assert_cleaned(fake)
    def test_sandbox_failure_retries_without_sandbox_only_when_allowed(self):
        fake = FakeChromium(live=lambda command: '--no-sandbox' in command)
        self.assertTrue(self.run_probe(fake, allow=True))
        self.assertEqual(len(fake.commands), 2)
        self.assertNotIn('--no-sandbox', fake.commands[0])
        self.assertIn('--no-sandbox', fake.commands[1])
        self.assertIn('--allow-no-sandbox', self.out)
        self.assertIn('CDP 점검 포트', self.out)
        self.assert_cleaned(fake)
    def test_no_sandbox_failure_keeps_runtime_error(self):
        fake = FakeChromium(live=lambda command: False)
        with self.assertRaises(RuntimeError) as error:
            self.run_probe(fake, allow=True)
        self.assertNotIsInstance(error.exception, installer.IsolationError)
        self.assertEqual(str(error.exception), '격리 브라우저 계정으로 Chromium을 시작하지 못했습니다. HERMES 설정은 바뀌지 않았습니다.')
        self.assertIn('CDP 점검 포트', self.err)
        self.assertEqual(len(fake.commands), 2)
        self.assert_cleaned(fake)
    def test_positive_page_that_never_loads_is_a_start_failure(self):
        fake = FakeChromium(data_pages=0)
        with self.assertRaises(installer.IsolationError) as error:
            self.run_probe(fake)
        self.assertIn('페이지를 열지 못했', str(error.exception))
        self.assertEqual(len(fake.opened), 1)
        self.assertLessEqual(len(self.sleeps), 10)
        self.assert_cleaned(fake)
    def test_file_page_title_exposed_stops_install(self):
        fake = FakeChromium(file_exposed=True)
        with self.assertRaises(installer.IsolationError) as error:
            self.run_probe(fake)
        self.assertIn('URLBlocklist', str(error.exception))
        self.assert_cleaned(fake)
    def test_recheck_failure_is_not_treated_as_policy_block(self):
        fake = FakeChromium(data_pages=1)
        with self.assertRaises(installer.IsolationError) as error:
            self.run_probe(fake)
        self.assertIn('재확인', str(error.exception))
        self.assertEqual(len(fake.opened), 3)
        self.assertNotIn('격리 확인: 브라우저 계정의 file://', self.out)
        self.assert_cleaned(fake)
    def test_probe_port_opened_by_another_uid_stops_install(self):
        fake = FakeChromium(owners=(991, 1001))
        with self.assertRaises(installer.IsolationError) as error:
            self.run_probe(fake, allow=True)
        self.assertIn('1001', str(error.exception))
        self.assertEqual(len(fake.commands), 1)
        self.assertEqual(fake.opened, [])
        self.assert_cleaned(fake)
    def test_probe_port_already_taken_before_launch_stops_install(self):
        # 이전 점검이 남긴 브라우저나 다른 계정이 먼저 답하면 점검 결과를 믿을 수 없다.
        fake = FakeChromium(squatters=(991,))
        with self.assertRaises(installer.IsolationError) as error:
            self.run_probe(fake, allow=True)
        self.assertIn(str(installer.PROBE_PORT), str(error.exception))
        self.assertEqual(fake.commands, [])
        self.assertEqual(fake.kills, [])
        self.assertEqual([command[0] for command, _ in fake.runs], ['pkill'])
    def test_leftover_probe_browser_is_ended_before_port_check(self):
        # 설치기가 SIGKILL 등으로 끝나 남은 점검 브라우저(같은 점검 프로필)는 포트 선점 확인 전에 끝낸다. 서비스 브라우저는 건드리지 않는다.
        fake = FakeChromium(squatters=(991,), leftover=True)
        self.assertFalse(self.run_probe(fake))
        pattern = 'user-data-dir=' + str(self.home / 'install-probe')
        self.assertEqual(fake.runs[0], (['pkill', '-KILL', '-u', installer.BROWSER_USER, '-f', pattern], 0))
        self.assertIsNone(re.search('user-data-dir=' + str(installer.BROWSER_HOME / 'install-probe'), installer.browser_unit(CHROME)))
        self.assertEqual(len(fake.commands), 1)
        self.assert_cleaned(fake)
    def test_probe_port_refused_to_other_local_accounts_while_listening(self):
        fake = FakeChromium()
        self.run_probe(fake)
        self.assertEqual(len(fake.denials), 1)
        label, command, who, opened, listening = fake.denials[0]
        self.assertEqual((label, who), ('CDP 점검 포트 접속(' + installer.NPM_USER + ' 계정)', '다른 로컬 계정'))
        connect = ['python3', '-c', installer.CONNECT, '127.0.0.1', installer.PROBE_PORT]
        self.assertEqual(command, [str(x) for x in installer.as_user(installer.NPM_USER, installer.NPM_HOME, connect)])
        # 점검 브라우저가 포트를 연 뒤(root의 /json/version이 양성 대조군) 첫 페이지를 열기 전에 확인한다.
        self.assertEqual((opened, listening), (0, True))
        self.assertIn('격리 확인: 다른 로컬 계정의 CDP 점검 포트 접속(' + installer.NPM_USER + ' 계정) 거부됨', self.out)
    def test_probe_port_reachable_by_other_account_stops_install(self):
        fake = FakeChromium(probe_denied=False)
        with self.assertRaises(installer.IsolationError) as error:
            self.run_probe(fake, allow=True)
        self.assertIn('CDP 점검 포트 접속', str(error.exception))
        self.assertEqual(len(fake.commands), 1)
        self.assertEqual(fake.opened, [])
        self.assert_cleaned(fake)
    def test_file_request_failure_is_not_evidence_of_policy_block(self):
        # /json/new 요청이 실패(HTTP 오류·시간 초과)하면 file:// 페이지를 연 적이 없어 정책 차단을 증명하지 못한다.
        fake = FakeChromium(file_open_fails=True)
        with self.assertRaises(installer.IsolationError) as error:
            self.run_probe(fake)
        self.assertIn('file:// 점검 페이지', str(error.exception))
        self.assertNotIn('격리 확인: 브라우저 계정의 file://', self.out)
        self.assertEqual(len(fake.opened), 2)
        self.assert_cleaned(fake)
    def test_file_title_appearing_late_is_caught_on_recheck(self):
        fake = FakeChromium(file_late=True)
        with self.assertRaises(installer.IsolationError) as error:
            self.run_probe(fake)
        self.assertIn('URLBlocklist', str(error.exception))
        self.assertEqual(len(fake.opened), 3)
        self.assert_cleaned(fake)
    def default_signals(self, handler=signal.SIG_DFL):
        for sig in (signal.SIGHUP, signal.SIGTERM):
            self.addCleanup(signal.signal, sig, signal.signal(sig, handler))
    def test_hangup_or_terminate_during_probe_still_ends_probe_browser(self):
        # ssh 연결 끊김(SIGHUP)·kill·timeout(SIGTERM)의 기본 동작은 finally 없이 끝나 새 세션의 점검 브라우저가 포트를 연 채 남는다.
        self.default_signals()
        for sig in (signal.SIGHUP, signal.SIGTERM):
            with self.subTest(signal=sig):
                fake = FakeChromium(interrupt=sig)
                with self.assertRaises(SystemExit) as stop:
                    self.run_probe(fake)
                self.assertEqual(stop.exception.code, 128 + sig)
                self.assert_cleaned(fake)
                self.assertEqual(signal.getsignal(sig), signal.SIG_DFL)
    def test_signal_handlers_only_during_probe_and_ignored_signals_stay_ignored(self):
        self.default_signals()
        fake = FakeChromium()
        self.run_probe(fake)
        for sig in (signal.SIGHUP, signal.SIGTERM):
            self.assertTrue(callable(fake.handlers[sig]))
            self.assertEqual(signal.getsignal(sig), signal.SIG_DFL)
        # nohup 등으로 무시하게 둔 신호는 그대로 둔다.
        signal.signal(signal.SIGHUP, signal.SIG_IGN)
        fake = FakeChromium()
        self.run_probe(fake)
        self.assertEqual(fake.handlers[signal.SIGHUP], signal.SIG_IGN)
        self.assertTrue(callable(fake.handlers[signal.SIGTERM]))
        self.assertEqual((signal.getsignal(signal.SIGHUP), signal.getsignal(signal.SIGTERM)), (signal.SIG_IGN, signal.SIG_DFL))
    def test_stop_probe_kills_group_even_when_waiting_times_out(self):
        kills = []
        def killpg(pid, sig):
            kills.append((pid, sig))
            if sig == signal.SIGKILL:
                raise ProcessLookupError(pid)
        process = FakeProcess(77, wait_error=subprocess.TimeoutExpired('runuser', 5))
        with mock.patch.object(installer.os, 'killpg', killpg):
            installer.stop_probe(process)
        self.assertEqual(kills, [(77, signal.SIGTERM), (77, signal.SIGKILL)])
    def test_log_tail_is_short_printable_and_never_empty(self):
        self.assertEqual(installer.log_tail(''), '(로그 없음)')
        self.assertEqual(installer.log_tail('a\n\n b \nc\x1b[0m\n'), 'a | b | c?[0m')
        self.assertEqual(installer.log_tail('\n'.join(str(i) for i in range(20))), '15 | 16 | 17 | 18 | 19')
        self.assertLessEqual(len(installer.log_tail('x' * 5000)), 501)

class CdpRequestTest(unittest.TestCase):
    def open_with(self, call, error=None):
        seen, handlers = [], []
        class Opener:
            def open(self, request, timeout=None):
                seen.append((request, timeout))
                if error:
                    raise error
                return io.BytesIO(b'{"ok": true}')
        def build(*items):
            handlers.extend(items)
            return Opener()
        with mock.patch.object(installer.urllib.request, 'build_opener', build):
            result = call()
        self.assertTrue(handlers and all(isinstance(h, installer.urllib.request.ProxyHandler) and h.proxies == {} for h in handlers))
        return result, seen
    def test_cdp_json_keeps_service_default_and_accepts_probe_base(self):
        result, seen = self.open_with(lambda: installer.cdp_json('/json/version'))
        self.assertEqual((result, seen[0][0]), ({'ok': True}, installer.CDP_URL + '/json/version'))
        result, seen = self.open_with(lambda: installer.cdp_json('/json/list', installer.PROBE_URL))
        self.assertEqual(seen[0][0], installer.PROBE_URL + '/json/list')
    def test_cdp_open_uses_put_json_new_on_probe_port(self):
        result, seen = self.open_with(lambda: installer.cdp_open('data:text/html,<title>abc</title>'))
        request = seen[0][0]
        self.assertTrue(result)
        self.assertEqual(request.get_method(), 'PUT')
        self.assertEqual(request.full_url, installer.PROBE_URL + '/json/new?data:text/html,%3Ctitle%3Eabc%3C/title%3E')
        self.assertEqual(installer.PROBE_URL, 'http://127.0.0.1:' + str(installer.PROBE_PORT))
        for error in (urllib.error.URLError('refused'), ConnectionRefusedError(), ValueError('bad json')):
            self.assertFalse(self.open_with(lambda: installer.cdp_open('file:///x'), error)[0])
    def test_installer_no_longer_uses_dump_dom(self):
        self.assertNotIn('--dump-dom', SOURCE.read_text())

class SupplyChainTest(unittest.TestCase):
    def test_npm_runs_as_dedicated_user_without_lifecycle_scripts(self):
        stage = installer.NPM_HOME / 'stage'
        for locked in (True, False):
            commands = installer.download_commands(stage, locked)
            self.assertEqual(len(commands), 2)
            for command in commands:
                self.assertEqual(command[:4], ['runuser', '-u', installer.NPM_USER, '--'])
                self.assertEqual(command[4:6], ['env', '-i'])
            self.assertEqual(commands[1][-2:], [str(stage / 'node_modules/.bin/agent-browser'), 'install'])
        self.assertEqual(installer.npm_command(True), ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'])
        unlocked = installer.npm_command(False)
        self.assertEqual(unlocked[:2], ['npm', 'install'])
        for flag in ('--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', 'agent-browser@0.26.0'):
            self.assertIn(flag, unlocked)
    def test_lockfile_pins_exact_version_and_integrity(self):
        files = installer.npm_files()
        package = json.loads(files['package.json'])
        self.assertEqual(package['dependencies'], {'agent-browser': '0.26.0'})
        lock = json.loads(files['package-lock.json'])
        entry = lock['packages']['node_modules/agent-browser']
        self.assertEqual(lock['lockfileVersion'], 3)
        self.assertEqual(entry['version'], '0.26.0')
        self.assertEqual(entry['resolved'], 'https://registry.npmjs.org/agent-browser/-/agent-browser-0.26.0.tgz')
        self.assertEqual(entry['integrity'], installer.AGENT_BROWSER_INTEGRITY)
        self.assertRegex(entry['integrity'], r'^sha512-[A-Za-z0-9+/]{86}==$')
        self.assertNotIn('package-lock.json', installer.npm_files(integrity=''))
    def test_root_steps_exclude_third_party_code(self):
        self.assertEqual(installer.ROOT_STEPS, ('apt 패키지 설치', '전용 계정 생성', 'root 소유 경로로 복사', 'AppArmor 프로필',
                                                'nftables 규칙', 'Chrome 정책', 'systemd 유닛·서비스', 'HERMES 설정 백업·변경', '격리 점검'))
        for step in installer.ROOT_STEPS:
            self.assertNotIn('npm', step)
            self.assertNotIn('내려받기', step)
    def test_chromium_libraries_prefer_ubuntu_24_t64_names(self):
        available = {'libasound2t64', 'libnss3', 'libcups2'}.__contains__
        groups = (('libasound2t64', 'libasound2'), 'libnss3', ('libcups2t64', 'libcups2'))
        self.assertEqual(installer.pick_packages(groups, available), ['libasound2t64', 'libnss3', 'libcups2'])
        with self.assertRaises(RuntimeError):
            installer.pick_packages(('libmissing',), available)
    def test_install_tree_replaces_target_without_group_or_other_write(self):
        with tempfile.TemporaryDirectory() as folder:
            source, target = Path(folder) / 'source', Path(folder) / 'target'
            (source / 'bin').mkdir(parents=True)
            (source / 'bin' / 'tool').write_text('new')
            os.chmod(source / 'bin' / 'tool', 0o777)
            (source / 'link').symlink_to('bin/tool')
            target.mkdir()
            (target / 'stale').write_text('old')
            installer.install_tree(source, target, os.getuid(), os.getgid())
            self.assertFalse((target / 'stale').exists())
            self.assertEqual((target / 'bin' / 'tool').read_text(), 'new')
            self.assertEqual(stat.S_IMODE(os.stat(target / 'bin' / 'tool').st_mode), 0o755)
            self.assertTrue((target / 'link').is_symlink())
            self.assertEqual(sorted(p.name for p in Path(folder).iterdir()), ['source', 'target'])
    def test_install_tree_can_restrict_top_directory(self):
        with tempfile.TemporaryDirectory() as folder:
            source, target = Path(folder) / 'source', Path(folder) / 'target'
            source.mkdir()
            (source / 'chrome').write_text('bin')
            installer.install_tree(source, target, os.getuid(), os.getgid(), top=(os.getgid(), 0o750))
            self.assertEqual(stat.S_IMODE(os.stat(target).st_mode), 0o750)
    def test_fresh_stage_replaces_symlink_without_following_it(self):
        with tempfile.TemporaryDirectory() as folder:
            outside, stage = Path(folder) / 'etc', Path(folder) / 'stage'
            outside.mkdir()
            (outside / 'keep').write_text('root file')
            os.chmod(outside, 0o755)
            stage.symlink_to(outside)
            installer.fresh_directory(stage, os.getuid(), os.getgid())
            self.assertFalse(stage.is_symlink())
            self.assertEqual(list(stage.iterdir()), [])
            self.assertEqual(stat.S_IMODE(os.stat(stage).st_mode), 0o700)
            self.assertEqual((outside / 'keep').read_text(), 'root file')
            self.assertEqual(stat.S_IMODE(os.stat(outside).st_mode), 0o755)
            (stage / 'node_modules').mkdir()
            installer.fresh_directory(stage, os.getuid(), os.getgid())
            self.assertEqual(list(stage.iterdir()), [])
    def test_copy_sources_must_not_pass_through_symlinks(self):
        with tempfile.TemporaryDirectory() as folder:
            base, outside = Path(folder) / 'npm', Path(folder) / 'secret'
            (base / 'stage').mkdir(parents=True)
            outside.mkdir()
            (base / 'stage' / 'node_modules').symlink_to(outside)
            with self.assertRaises(RuntimeError):
                installer.safe_source(base / 'stage' / 'node_modules', base)
            (base / 'browsers').mkdir()
            (base / 'browsers' / 'chrome-1').symlink_to(outside)
            (outside / 'chrome-linux64').mkdir()
            with self.assertRaises(RuntimeError):
                installer.safe_source(base / 'browsers' / 'chrome-1' / 'chrome-linux64', base)
            with self.assertRaises(RuntimeError):
                installer.safe_source(outside, base)
            (base / 'browsers' / 'chrome-2').mkdir()
            self.assertEqual(installer.safe_source(base / 'browsers' / 'chrome-2', base), base / 'browsers' / 'chrome-2')
    def test_copied_executables_must_be_regular_files(self):
        with tempfile.TemporaryDirectory() as folder:
            real, link = Path(folder) / 'agent-browser-linux-x64', Path(folder) / 'link'
            real.write_text('elf')
            link.symlink_to('/etc/hostname')
            self.assertEqual(installer.regular_file(real), real)
            with self.assertRaises(RuntimeError):
                installer.regular_file(link)
            with self.assertRaises(RuntimeError):
                installer.regular_file(Path(folder) / 'missing')
    def test_atomic_sets_owner_and_mode_through_the_descriptor(self):
        # 경로 기준 chown·chmod는 임시 파일이 링크로 바뀌면 링크 대상을 바꾼다. 파일 기술자로만 바꾼다.
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'policy.json'
            with mock.patch.object(installer.os, 'chown', side_effect=AssertionError('path chown')), \
                 mock.patch.object(installer.os, 'chmod', side_effect=AssertionError('path chmod')):
                installer.atomic(path, 'data', os.getuid(), os.getgid(), 0o640)
            self.assertEqual(path.read_text(), 'data')
            self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o640)
            self.assertEqual([p.name for p in Path(folder).iterdir()], ['policy.json'])
    def test_leftover_npm_processes_are_killed_before_root_touches_files(self):
        calls = []
        def runner(args, **kwargs):
            calls.append(args[0])
            return subprocess.CompletedProcess(args, 1 if calls.count('pgrep') > 1 else 0)
        installer.stop_processes('collective-npm', runner=runner, sleep=lambda s: None)
        self.assertEqual(calls, ['pgrep', 'pkill', 'pgrep'])
        stuck = lambda args, **kwargs: subprocess.CompletedProcess(args, 0)
        with self.assertRaises(RuntimeError):
            installer.stop_processes('collective-npm', runner=stuck, sleep=lambda s: None)

class WorkerAccountTest(unittest.TestCase):
    def test_worker_runs_as_its_own_account(self):
        unit = installer.worker_unit()
        self.assertIn('\nUser=' + installer.WORKER_USER + '\n', unit)
        self.assertNotIn('User=hermes', unit)
        self.assertIn('ExecStart=/usr/bin/python3 /opt/collective-research/worker.py /etc/collective-research/worker.json', unit)
        for line in ('NoNewPrivileges=true', 'ProtectHome=true', 'ProtectSystem=strict', 'RestartPreventExitStatus=78'):
            self.assertIn(line, unit)
        # 토큰 자동 교체는 설정 폴더에만 쓴다. ProtectSystem=strict 아래에서 그 폴더 하나만 연다.
        self.assertIn('\nReadWritePaths=/etc/collective-research\n', unit)
        self.assertEqual(unit.count('ReadWritePaths='), 1)
        hermes = account('hermes', 1000, 1000)
        self.assertEqual(installer.isolation_problems(account(installer.WORKER_USER, 992, 992), hermes, [992]), [])
        self.assertNotEqual(installer.WORKER_USER, installer.BROWSER_USER)

class InstallerFileTest(unittest.TestCase):
    def test_placeholders_appear_once_for_first_match_replace(self):
        text = SOURCE.read_text()
        self.assertEqual(text.count('__COLLECTIVE_CONFIG_HEX__'), 1)
        self.assertEqual(text.count('__COLLECTIVE_WORKER_HEX__'), 1)
    def test_options(self):
        self.assertEqual(installer.parse_args([]), {'allow_no_sandbox': False})
        self.assertEqual(installer.parse_args(['--allow-no-sandbox']), {'allow_no_sandbox': True})
        with self.assertRaises(RuntimeError):
            installer.parse_args(['--no-sandbox'])
    def test_installer_deletes_itself_only_after_success(self):
        removed = []
        with tempfile.NamedTemporaryFile(delete=False) as handle:
            script = Path(handle.name)
        try:
            self.assertEqual(installer.cli([], install=lambda options: None, remove=removed.append, script=script), 0)
            self.assertEqual(removed, [script])
            def fail(options):
                raise RuntimeError('stop')
            self.assertEqual(installer.cli([], install=fail, remove=removed.append, script=script), 1)
            self.assertEqual(removed, [script])
            self.assertEqual(installer.cli(['--bogus'], install=lambda options: None, remove=removed.append, script=script), 1)
            self.assertEqual(removed, [script])
        finally:
            script.unlink(missing_ok=True)
    def test_self_delete_uses_unlink_and_survives_failure(self):
        with tempfile.NamedTemporaryFile(delete=False) as handle:
            script = Path(handle.name)
        self.assertTrue(installer.remove_installer(script))
        self.assertFalse(script.exists())
        def refuse(path):
            raise PermissionError(path)
        self.assertFalse(installer.remove_installer(script, unlink=refuse))

if __name__ == '__main__':
    unittest.main()
