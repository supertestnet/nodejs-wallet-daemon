# Nodejs wallet daemon
A nodejs wallet daemon managed via get requests

This wallet is a dependency for the test version of my atomic swap service. When I arrange swaps between the lightning network and the base layer, this wallet manages my base layer funds and LND manages my lightning network funds. I currently have those separate because the test version of my swap service receives mainnet funds and sends testnet funds.

# Installation

Before running the app, run `npm install bitcoinjs-lib ecpair tiny-secp256k1 axios varuint-bitcoin bip32 bip39`

Then run `node server.js`

The server will spit out a password and start listening for traffic on localhost port 8087.

# Commands

Get an unused address: http://localhost:8087/newaddress?password=YOUR_PASSWORD.

Send money: http://localhost:8087/?address=tb1qualwxge0zk2a826msftgcfv9ea7mtuzchtm46x&amount=546&password=YOUR_PASSWORD

The amount must be denominated in sats.
