#!/usr/bin/env python3
"""
本地静态服务器 —— 给手机做真机测试用。

用法：
    python3 serve.py            # 默认 8080 端口，服务仓库根目录
    python3 serve.py 8000       # 指定端口

启动后终端里会打印二维码和地址：
  · 手机扫码可直接打开（手机与电脑需在同一 Wi-Fi，或用下面的云端预览地址）
  · 浏览器 / Arena 的实时预览地址也会一并打印

不依赖任何第三方库（二维码是可选增强：装了 qrcode 才会显示）。
"""
import http.server
import socketserver
import sys
import os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
ROOT = os.path.dirname(os.path.abspath(__file__))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True          # 必须在实例化之前设成类属性才生效
    daemon_threads = True


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        # 真机测试期间一律不缓存，避免改了页面手机上还是旧的
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write('  %s\n' % (fmt % args))


def local_ips():
    import socket
    ips = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ips.append(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip not in ips and not ip.startswith('127.'):
                ips.append(ip)
    except Exception:
        pass
    return ips


def qr(text):
    try:
        import qrcode
    except ImportError:
        return '(未安装 qrcode，跳过二维码：pip install --break-system-packages qrcode)'
    q = qrcode.QRCode(border=1, error_correction=qrcode.constants.ERROR_CORRECT_M)
    q.add_data(text)
    q.make(fit=True)
    m = q.get_matrix()
    # 用 Unicode 半块字符，终端里一行显示两行点阵
    lines = []
    for r in range(0, len(m), 2):
        top = m[r]
        bot = m[r + 1] if r + 1 < len(m) else [False] * len(top)
        lines.append(''.join(
            '█' if (t and b) else '▀' if t else '▄' if b else ' ' for t, b in zip(top, bot)))
    return '\n'.join(lines)


def main():
    os.chdir(ROOT)
    sandbox = os.environ.get('E2B_SANDBOX_ID')
    urls = []
    if sandbox:
        urls.append('https://%d-%s.e2b.app/bottom-radius-test/' % (PORT, sandbox))
    for ip in local_ips():
        urls.append('http://%s:%d/bottom-radius-test/' % (ip, PORT))
    urls.append('http://localhost:%d/bottom-radius-test/' % PORT)

    with Server(('0.0.0.0', PORT), Handler) as httpd:
        print('=' * 62, flush=True)
        print('  屏幕底部遮挡 & 圆角半径实测 —— 本地服务器已启动')
        print('  服务目录: %s' % ROOT)
        print('=' * 62)
        for u in urls:
            print('  %s' % u)
        print('-' * 62)
        print('  手机扫码打开（推荐：手机与电脑同一 Wi-Fi）：')
        for u in urls[:2]:
            print()
            print('  地址: %s' % u)
            print(qr(u))
            print('-' * 62)
        print('  Ctrl-C 停止')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\n  已停止')


if __name__ == '__main__':
    main()
