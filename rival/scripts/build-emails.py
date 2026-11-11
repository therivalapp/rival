"""Builds RIVAL's designed emails (Mockups 18 and 19, 2026-11-10) into
supabase/templates/. The sign-in ones are pasted into Supabase (Authentication,
Emails, Templates); Supabase fills {{ .ConfirmationURL }} and {{ .NewEmail }}.
The Team Beta confirmation lives in supabase/functions/beta-signup (same layout).
Run: python3 scripts/build-emails.py"""
import os
OUT = os.path.join(os.path.dirname(__file__), '..', 'supabase', 'templates')
SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"
SERIF = "Georgia,'Times New Roman',serif"
P = f'margin:0 0 14px;font-family:{SANS};font-size:15px;line-height:1.6;color:#d4d1ce'
NOTE = f'margin:18px 0 0;font-family:{SANS};font-size:12px;line-height:1.5;color:#8a8682'


def button(label, url):
    return (f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:12px auto 4px"><tr>'
            f'<td align="center" bgcolor="#ec9a7f" style="border-radius:999px;background-color:#ec9a7f;background-image:linear-gradient(135deg,#D97757 0%,#ffb59e 100%)">'
            f'<a href="{url}" style="display:inline-block;padding:15px 34px;font-family:{SANS};font-size:15px;font-weight:800;color:#5c1902;text-decoration:none;border-radius:999px">{label}</a></td></tr></table>')


def email(title, lines, btn=None, note=None, kicker=None, photo=None, footer=None):
    head = (f'<tr><td style="padding:0;line-height:0"><img src="{photo}" width="520" alt="" '
            f'style="display:block;width:100%;height:auto;border:0;border-radius:20px 20px 0 0"></td></tr>') if photo else ''
    pad = '14px 40px 36px' if photo else '40px 40px 36px'
    kick = (f'<div style="font-family:{SANS};font-size:11px;font-weight:800;letter-spacing:2.5px;color:#ffb59e;margin:0 0 10px">{kicker}</div>') if kicker else ''
    size = 36 if kicker else 30
    body = ''.join(f'<p style="{P}">{l}</p>' for l in lines)
    b = button(*btn) if btn else ''
    n = f'<p style="{NOTE}">{note}</p>' if note else ''
    foot = (footer + '<br>') if footer else ''
    return (
        '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        '<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">'
        f'<title>{title}</title><style>body{{margin:0}}@media (max-width:480px){{.card{{padding-left:22px !important;padding-right:22px !important}}'
        '.title{font-size:26px !important}.outer{padding:28px 12px !important}}</style></head>'
        '<body style="margin:0;background:#1b1a19">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#1b1a19" style="background:#1b1a19"><tr>'
        '<td class="outer" align="center" style="padding:40px 16px">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px">'
        f'<tr><td align="center" style="padding:0 0 22px;font-family:{SERIF};font-style:italic;font-size:18px;font-weight:700;letter-spacing:4px;padding-left:4px;color:#ffb59e">RIVAL</td></tr>'
        '<tr><td bgcolor="#262626" style="background:#262626;border:1px solid #363636;border-radius:20px;padding:0">'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">{head}'
        f'<tr><td class="card" align="center" style="padding:{pad};text-align:center">{kick}'
        f'<h1 class="title" style="margin:0 0 16px;font-family:{SERIF};font-style:italic;font-weight:700;font-size:{size}px;line-height:1.2;color:#ffffff">{title}</h1>'
        f'{body}{b}{n}</td></tr></table></td></tr>'
        f'<tr><td align="center" style="padding:22px 8px 0;font-family:{SANS};font-size:12px;line-height:1.6;color:#8a8682">{foot}'
        'RIVAL &middot; <a href="https://therivalapp.com" style="color:#8a8682;text-decoration:underline">therivalapp.com</a></td></tr>'
        '</table></td></tr></table></body></html>')


EXPIRES = 'This link expires in 1 hour. If you did not ask for this, ignore this email.'
TEMPLATES = {
    # Supabase template name: (subject, html)
    'recovery': ('Reset your RIVAL password', email('Reset your password', ['Choose a new password for your RIVAL account.'],
                 ('Reset password', '{{ .ConfirmationURL }}'), EXPIRES)),
    'confirmation': ('Confirm your email', email('Confirm your email', ['Confirm this address to finish creating your RIVAL account.'],
                     ('Confirm email', '{{ .ConfirmationURL }}'), 'If you did not create an account, ignore this email. The account stays inactive.')),
    # Sent to both the old and new address, so it names the new one.
    'email_change': ('Confirm your new email', email('Confirm your new email', ['Confirm changing your RIVAL email to {{ .NewEmail }}.'],
                     ('Confirm email', '{{ .ConfirmationURL }}'), 'If you did not ask for this, ignore this email.')),
    # Magic link is only used by Delete account (delete-account.tsx); the link
    # opens /confirm-delete, which asks once more before deleting.
    'magic_link': ('Delete your RIVAL account', email('Delete your account', ['Nothing is deleted until you confirm on the next page.'],
                   ('Continue', '{{ .ConfirmationURL }}'), EXPIRES)),
    # Not a Supabase template: sent when the beta opens (Mockup 19). {{name}}
    # and {{link}} are filled by whatever sends the invites.
    'team-beta-invite': ('You have been accepted into RIVAL Team Beta', email(
        'You are in', ['Hi {{name}}, you have been accepted into RIVAL Team Beta. You are one of the first to use it.',
                       'Install RIVAL on your iPhone through TestFlight, Apple&rsquo;s app for testing new apps.'],
        ('Join Team Beta', '{{link}}'), kicker='TEAM BETA', photo='https://therivalapp.com/img/email-invite.jpg',
        footer='You are receiving this because you joined the Team Beta list. To be removed, reply to this email.')),
}

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'SUBJECTS.md'), 'w') as s:
        s.write('# Email subjects\n\nGenerated by scripts/build-emails.py.\n\n')
        for name, (subject, html) in TEMPLATES.items():
            open(os.path.join(OUT, f'{name}.html'), 'w').write(html)
            s.write(f'- {name}.html: {subject}\n')
    print('\n'.join(TEMPLATES))
