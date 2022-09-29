# Nodejs wallet daemon
A nodejs wallet daemon managed via get requests

This wallet is a dependency for my atomic swap service. When I arrange swaps between the lightning network and the base layer, this wallet manages my base layer funds and LND manages my lightning network funds. I currently have those separate because the test version of my swap service receives mainnet funds and sends testnet funds. TODO: automatically create the db.txt file (which I use to ensure I don't accidentally send money to the same HTLC twice) and modify it to use an HD wallet instead of reusing a single private key.
