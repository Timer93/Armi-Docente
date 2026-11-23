// Run explicitly and pipe to Set-Clipboard. Never commit this output.
import {randomBytes} from 'node:crypto';
process.stdout.write(randomBytes(32).toString('hex'));
