#!/bin/sh
# launcher.sh
# navigate to app's directory, execute sudo "$(which node)" index.js

cd /
cd home/pi/access-qr/
# . ~/.config/nvm/nvm.sh
# nvm use 8.9.0
sudo npm start

# sudo crontab -e
# @reboot sh /home/saulprl/dev/csipro/access-ble/launcher.sh > /home/saulprl/logs/cronlog 2>&1
