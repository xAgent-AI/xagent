import re

with open('src/session.ts', 'r', encoding='utf-8') as f:
    content = f.read()

old = """    console.log('');
    console.log(colors.gradient('╔════════════════════════════════════════════════════════════╗'));
    console.log(colors.gradient('║') + ' '.repeat(56) + colors.gradient('║'));
    console.log(' '.repeat(12) + colors.gradient('🤖 XAGENT CLI') + ' '.repeat(37) + colors.gradient('║'));
    console.log(' '.repeat(14) + colors.textMuted('v1.0.0') + ' '.repeat(40) + colors.gradient('║'));
    console.log(colors.gradient('║') + ' '.repeat(56) + colors.gradient('║'));
    console.log(colors.gradient('╚════════════════════════════════════════════════════════════╝'));
    console.log(colors.textMuted('  AI-powered command-line assistant'));
    console.log('');"""

new = """    console.log('');
    console.log(colors.gradient('╔════════════════════════════════════════════════════════════╗'));
    console.log(colors.gradient('║') + ' '.repeat(58) + colors.gradient('  ║'));
    console.log(' '.repeat(14) + '🤖 ' + colors.gradient('XAGENT CLI') + ' '.repeat(32) + colors.gradient('  ║'));
    console.log(' '.repeat(17) + colors.textMuted('v1.0.0') + ' '.repeat(36) + colors.gradient('  ║'));
    console.log(colors.gradient('║') + ' '.repeat(58) + colors.gradient('  ║'));
    console.log(colors.gradient('╚════════════════════════════════════════════════════════════╝'));
    console.log(colors.textMuted('  AI-powered command-line assistant'));
    console.log('');"""

if old in content:
    content = content.replace(old, new)
    with open('src/session.ts', 'w', encoding='utf-8') as f:
        f.write(content)
    print('OK')
else:
    print('NOT FOUND')
