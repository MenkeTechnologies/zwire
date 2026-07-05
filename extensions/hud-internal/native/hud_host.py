#!/usr/bin/env python3
"""zwire HUD native-messaging host: writes the picked scheme to
~/.zwire/hud-scheme so the native color mixer (compiled) can follow the
in-page 8-scheme picker live."""
import sys, os, struct, json

def read_msg():
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return None
    n = struct.unpack('<I', raw)[0]
    return json.loads(sys.stdin.buffer.read(n).decode('utf-8'))

def send_msg(obj):
    data = json.dumps(obj).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('<I', len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()

def current_scheme(d):
    try:
        with open(os.path.join(d, 'hud-scheme')) as f:
            s = f.read().strip()
        return s or 'cyberpunk'
    except OSError:
        return 'cyberpunk'

def main():
    d = os.path.expanduser('~/.zwire')
    os.makedirs(d, exist_ok=True)
    allowed = {'cyberpunk','midnight','matrix','ember','arctic','crimson','toxic','vapor'}
    while True:
        msg = read_msg()
        if msg is None:
            break
        # Read: return the current shared scheme (used by the newtab to follow).
        if msg.get('cmd') == 'get':
            send_msg({'ok': True, 'scheme': current_scheme(d)})
            continue
        # Write: set the shared scheme (used by the picker).
        scheme = str(msg.get('scheme', 'cyberpunk'))
        if scheme in allowed:
            tmp = os.path.join(d, 'hud-scheme.tmp')
            with open(tmp, 'w') as f:
                f.write(scheme + '\n')
            os.replace(tmp, os.path.join(d, 'hud-scheme'))
            send_msg({'ok': True, 'scheme': scheme})
        else:
            send_msg({'ok': False})

if __name__ == '__main__':
    main()
