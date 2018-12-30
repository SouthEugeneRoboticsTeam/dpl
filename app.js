const execa = require('execa');
const wifiName = require('wifi-name');
const program = require('commander');
const isReachable = require('is-reachable');
const Listr = require('listr');
const { Observable } = require('rxjs');

program
    .version('0.0.1')
    .arguments('[dir]')
    .option('-n, --no-net-check', 'disable network checking (this will still be performed by GradleRIO)')
    .parse(process.argv);

async function asyncForEach(array, callback) {
    for (let index = 0; index < array.length; index++) {
        await callback(array[index], index, array);
    }
}

function checkConnection(teamNumber, update = () => {}) {
    return new Promise(async (resolve, reject) => {
        teamNumber = parseInt(teamNumber)

        const addresses = [
            `roborio-${teamNumber}-FRC.local`,
            `10.${parseInt(teamNumber / 100)}.${parseInt(teamNumber % 100)}.2`,
            `172.22.11.2`,
            `roborio-${teamNumber}-FRC`,
            `roborio-${teamNumber}-FRC.lan`,
            `roborio-${teamNumber}-FRC.frc-field.local`,
        ]

        const connected = false
        await asyncForEach(addresses, async (address) => {
            update(address)
            const success = await isReachable(address)

            if (success) resolve()
        })

        if (!connected) reject(new Error('Could not establish communication'))
    })
}

const tasks = new Listr([
    {
        title: 'Ensuring robot connection',
        task: (ctx, task) => {
            if (!program.netCheck) return task.skip()

            return new Observable(async (observer) => {
                observer.next('Checking network')

                let ssid
                try {
                    ssid = wifiName.sync()
                } catch (error) {
                    ssid = ''
                }

                let teamNumber = ssid.split('_')[0]

                // Ensure it's a valid number
                if (/^\d+$/.test(teamNumber)) {
                    observer.next('Checking connection')

                    try {
                        await checkConnection(teamNumber, (address) => {
                            observer.next(`Testing connection to ${address}...`)
                        })

                        observer.complete()
                    } catch (error) {
                        observer.error(error)
                    }
                } else {
                    observer.error(
                        new Error(`${ssid} is not a valid robot network (skip this check with --no-net-check)`)
                    )
                }
            })
        }
    },
    {
        title: 'Deploying robot code',
        task: () => new Observable((observer) => {
            observer.next('Booting up GradleRIO...')

            const cwd = program.args[0] || '.'
            const command = execa('gradle', ['deploy'], { cwd })

            command
                .then(() => observer.complete())
                .catch(() => observer.error(
                    new Error('An error occurred while deploying code. Run GradleRIO directly for more details.')
                ))

            command.stdout.on('data', data => {
                data = data.toString()

                if (data.includes(':discoverRoborio')) observer.next('Discovering roboRIO...')
                if (data.includes(':deployJre')) observer.next('Deploying JRE...')
                if (data.includes(':deployRoborioCommands')) observer.next('Deploying roboRIO commands...')
                if (data.includes(':deployNativeLibs')) observer.next('Deploying native libs...')
                if (data.includes(':deployNativeZips')) observer.next('Deploying native zips...')
                if (data.includes(':deployMain')) observer.next('Deploying code to roboRIO...')
            })
        })
    }
]);

tasks.run().then(() => process.exit(0)).catch(() => setTimeout(process.exit.bind(this, 1), 100));
