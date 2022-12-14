const http = require( 'http' );
const bitcoinjs = require( 'bitcoinjs-lib' );
const { ECPairFactory } = require( 'ecpair' );
const crypto = require( 'crypto' );
const ecc = require( 'tiny-secp256k1' );
const axios = require( 'axios' );
const varuintBitcoin = require( 'varuint-bitcoin' );
const bip32Factory = require( 'bip32' );
const { BIP32Factory, BIP32Interface } = require( 'bip32' );
const bip32 = BIP32Factory( ecc );
const bip39 = require( 'bip39' );
const ECPair = ECPairFactory( ecc );
const url = require( 'url' );
const fs = require( 'fs' );

class ls {
        constructor(content) {
                this.content = {}
        }
        setContent( key, value ) {
                this.content[ key ] = value;
                var texttowrite = JSON.stringify( this.content );
                fs.writeFileSync( "localStorage.txt", texttowrite, function() {return;});
        }
}

var localStorage = new ls();

if ( !fs.existsSync( "localStorage.txt" ) ) {
        var texttowrite = JSON.stringify( localStorage.content );
        fs.writeFileSync( "localStorage.txt", texttowrite, function() {return;});
} else {
        var lstext = fs.readFileSync( "localStorage.txt" ).toString();
        localStorage.content = JSON.parse( lstext );
}

if ( !localStorage.content[ "backup_words" ] ) {
        localStorage.setContent( "backup_words", bip39.generateMnemonic() );
}
if ( !localStorage.content[ "index-of-first-known-unused-receive-address" ] ) {
        localStorage.setContent( "index-of-first-known-unused-receive-address", 0 );
}
if ( !localStorage.content[ "index-of-first-known-unused-change-address" ] ) {
        localStorage.setContent( "index-of-first-known-unused-change-address", 0 );
}

if ( !fs.existsSync( "db.txt" ) ) {
        var db = [];
        var texttowrite = JSON.stringify( db );
        fs.writeFileSync( "db.txt", texttowrite, function() {return;});
}

if ( !fs.existsSync( "password.txt" ) ) {
        var global_password = ECPair.makeRandom().privateKey.toString( "hex" );
        console.log( "the password is:", global_password );
        fs.writeFileSync( "password.txt", global_password, function() {return;});
} else {
        var global_password = fs.readFileSync( "password.txt" ).toString();
        console.log( "the password is:", global_password );
}

function makeGetRequest( url ) {
        return new Promise( function( resolve, reject ) {
                axios.default
                .get( url )
                .then( res => {
                        resolve( res.data );
                });
        });
}

function postData( url, json ) {
        return new Promise( function( resolve, reject ) {
                axios.post( url, json )
                .then( res => {
                        resolve( res.data );
                }).catch( function( error ) {
                        console.log( "oh no!", error.message );
                });
        });
}

function makePostRequest( url, json ) {
        return new Promise( function( resolve, reject ) {
                axios.post( url, json )
                .then( res => {
                        resolve( res.data );
                }).catch( function( error ) {
                        console.log( "oh no!", error.message );
                });
        });
}

function getCompressedPubkeyHexFromPrivkeyHex( privkeyhex ) {
        return ECPair.fromPrivateKey( Buffer.from( privkeyhex, "hex" ), { network: bitcoinjs.networks.testnet } ).publicKey.toString( "hex" );
}

function getNativeSegwitAddressFromPrivkeyHex( privkeyhex ) {
        return bitcoinjs.payments.p2wpkh({ pubkey: ECPair.fromPrivateKey( Buffer.from( privkeyhex, "hex" ), { network: bitcoinjs.networks.testnet } ).publicKey, network: bitcoinjs.networks.testnet }).address;
}

function computeRawPrivkey( node ) {
    return ECPair.fromPrivateKey( node.privateKey, { network: bitcoinjs.networks.testnet } ).__D.toString( "hex" );
}

function getNativeSegwitAddressFromPrivkeyHex( privkeyhex ) {
    return bitcoinjs.payments.p2wpkh({ pubkey: ECPair.fromPrivateKey( Buffer.from( privkeyhex, "hex" ), { network: bitcoinjs.networks.testnet } ).publicKey, network: bitcoinjs.networks.testnet }).address;
}

function getPrivkeyHexFromPath( backupwords, path, index ) {
    //standard segwit path is m/84'/0'/0'/0 so ???path??? should be 84'/0'/0' and ???index??? 0
    var seed = bip39.mnemonicToSeedSync( backupwords );
    var node = bip32.fromSeed( seed );
    var path = "m/" + path + "/" + index;
    var root = node;
    var child = root.derivePath( path );
    return computeRawPrivkey( child );
}

function getAddressFromPath( backupwords, path, index ) {
    var privkey = getPrivkeyHexFromPath( backupwords, path, index );
    var address = getNativeSegwitAddressFromPrivkeyHex( privkey );
    return address;
}

async function getUTXOs( privkey ) {
        var pubkey = getCompressedPubkeyHexFromPrivkeyHex( privkey );
        var address = getNativeSegwitAddressFromPrivkeyHex( privkey );
        var esplorautxos = await makeGetRequest( "https://blockstream.info/testnet/api/address/" + address + "/utxo" );
        var obj = [];
        esplorautxos.forEach( function( item, index ) {
                var utxo = {}
                utxo[ "tx_id" ] = item[ "txid" ];
                utxo[ "output_number" ] = item[ "vout" ];
                utxo[ "amount" ] = item[ "value" ];
                utxo[ "privkey" ] = privkey;
                utxo[ "pubkey" ] = pubkey;
                obj.push( utxo );
        });
        return( obj );
}

async function getAddressBalance( address ) {
        var json = await makeGetRequest( "https://mempool.space/testnet/api/address/" + address );
        var fullincome = json[ "chain_stats" ][ "funded_txo_sum" ] + json[ "mempool_stats" ][ "funded_txo_sum" ];
        var fulloutgo = json[ "chain_stats" ][ "spent_txo_sum" ] + json[ "mempool_stats" ][ "spent_txo_sum" ];
        return fullincome - fulloutgo;
}

async function getAvailableUtxosFromReceivePath() {
    return new Promise( async function( resolve, reject ) {
        var available_utxos = [];
        var i1 = 0;
        var i2 = 0;
        var i; for ( i=0; i<100000; i++ ) {
            var starting_index = Number( localStorage.content[ "index-of-first-known-unused-receive-address" ] );
            var starting_change_index = Number( localStorage.content[ "index-of-first-known-unused-change-address" ] );
            if ( i2 > starting_index + 20 ) {
                    break;
            }
            var backupwords = localStorage.content[ "backup_words" ];
            var path = "84'/0'/0'";
            var privkey = getPrivkeyHexFromPath( backupwords, path, i1 + i2 );
            var address = getNativeSegwitAddressFromPrivkeyHex( privkey );
            var balance = await getAddressBalance( address );
            if ( balance < 1 ) {
                i2 = Number( i2 ) + 1;
            } else {
                i1 = Number( i1 ) + 1;
                var utxos_in_this_address = await getUTXOs( privkey );
                utxos_in_this_address.forEach( function( item ) {
                        available_utxos.push( item );
                });
            }
        }
        resolve( available_utxos );
    });
}

async function getAvailableUtxosFromChangePath() {
    return new Promise( async function( resolve, reject ) {
        var available_utxos = [];
        var i1 = 0;
        var i2 = 0;
        var i; for ( i=0; i<100000; i++ ) {
            var starting_index = Number( localStorage.content[ "index-of-first-known-unused-receive-address" ] );
            var starting_change_index = Number( localStorage.content[ "index-of-first-known-unused-change-address" ] );
            if ( i2 > starting_change_index + 20 ) {
                break;
            }
            var backupwords = localStorage.content[ "backup_words" ];
            var path = "84'/0'/1'";
            var privkey = getPrivkeyHexFromPath( backupwords, path, i1 + i2 );
            var address = getNativeSegwitAddressFromPrivkeyHex( privkey );
            var balance = await getAddressBalance( address );
            if ( balance < 1 ) {
                i2 = Number( i2 ) + 1;
            } else {
                i1 = Number( i1 ) + 1;
                var utxos_in_this_address = await getUTXOs( privkey );
                utxos_in_this_address.forEach( function( item ) {
                        available_utxos.push( item );
                });
            }
        }
        resolve( available_utxos );
    });
}

async function checkAddresses() {
        var first_unused_receive_address = await getFirstUnusedAddress();
        var first_unused_change_address = await getFirstUnusedChangeAddress();
        var available_utxos_1 = await getAvailableUtxosFromReceivePath();
        var available_utxos_2 = await getAvailableUtxosFromChangePath();
        available_utxos_2.forEach( function( item ) {
                available_utxos_1.push( item );
        });
        localStorage.setContent( "utxos", JSON.stringify( available_utxos_1 ) );
}

async function didThisAddressEverHaveMoney( address ) {
        var json = await makeGetRequest( "https://mempool.space/testnet/api/address/" + address );
        if ( json[ "chain_stats" ][ "funded_txo_count" ] > 0 || json[ "mempool_stats" ][ "funded_txo_count" ] > 0 ) {
            return true;
        }
        return;
}

async function getFirstUnusedAddress() {
    var starting_index = Number( localStorage.content[ "index-of-first-known-unused-receive-address" ] );
    var i; for ( i=starting_index; i<100000; i++ ) {
        var backupwords = localStorage.content[ "backup_words" ];
        var path = "84'/0'/0'";
        var privkey = getPrivkeyHexFromPath( backupwords, path, i );
        var address = getNativeSegwitAddressFromPrivkeyHex( privkey );
        var hadMoney = await didThisAddressEverHaveMoney( address );
        if ( !hadMoney ) {
            localStorage.setContent( "index-of-first-known-unused-receive-address", i );
            return address;
        }
    }
}

async function getFirstUnusedChangeAddress() {
    var starting_index = Number( localStorage.content[ "index-of-first-known-unused-change-address" ] );
    var i; for ( i=starting_index; i<100000; i++ ) {
        var backupwords = localStorage.content[ "backup_words" ];
        var path = "84'/0'/1'";
        var privkey = getPrivkeyHexFromPath( backupwords, path, i );
        var address = getNativeSegwitAddressFromPrivkeyHex( privkey );
        var hadMoney = await didThisAddressEverHaveMoney( address );
        if ( !hadMoney ) {
            localStorage.setContent( "index-of-first-known-unused-change-address", i );
            return address;
        }
    }
}

function witnessStackToScriptWitness(witness) {
  let buffer2 = Buffer.allocUnsafe(0);
  function writeSlice(slice) {
        buffer2 = Buffer.concat([buffer2, Buffer.from(slice)]);
  }
  function writeVarInt(i) {
        const currentLen = buffer2.length;
        const varintLen = varuintBitcoin.encodingLength(i);
        buffer2 = Buffer.concat([buffer2, Buffer.allocUnsafe(varintLen)]);
        varuintBitcoin.encode(i, buffer2, currentLen);
  }
  function writeVarSlice(slice) {
        writeVarInt(slice.length);
        writeSlice(slice);
  }
  function writeVector(vector) {
        writeVarInt(vector.length);
        vector.forEach(writeVarSlice);
  }
  writeVector(witness);
  return buffer2;
}

function generateHtlcWithUserTimelocked( serverPubkey, userPubkey, pmthash, timelock ) {
        return bitcoinjs.script.fromASM(
                `
                        OP_HASH160
                        ${ pmthash }
                        OP_EQUAL
                        OP_IF
                                ${ serverPubkey }
                        OP_ELSE
                                ${ bitcoinjs.script.number.encode( timelock ).toString( 'hex' ) }
                                OP_CHECKLOCKTIMEVERIFY
                                OP_DROP
                                ${ userPubkey }
                        OP_ENDIF
                        OP_CHECKSIG
                `
                .trim()
                .replace(/\s+/g, ' '),
        );
}

//1. Define a variable ???sats_per_byte??? whose default value is 1 (the interface should let the user modify it to some other integer).

//2. Define a variable ???amount_plus_fee??? whose value is the sum of the amount plus 150*sats_per_byte (which assumes the transaction has 0 inputs and is therefore 150 bytes and that the fee $

//3. Define a variable ???utxos_available_for_this_transaction??? whose value is equal to the full utxo set owned by the wallet and a variable ???utxos_in_this_transaction??? whose value is equal t$

//Steps 4 through 9 are in the function ???addUtxosToTx???

async function pushBTCpmt( rawtx ) {
        var success = await postData( "https://blockstream.info/testnet/api/tx", rawtx );
        return success;
}

function craftTransaction( selected_utxos, to_amount, to_address, change_address, change_amount, sats_per_byte ) {
        if ( !to_amount ) {
                return;
        }
        if ( change_amount != 0 && change_address != "none" ) {
                //do the part of step 11 where you create a raw bitcoin transaction, and do it with a change address
                var psbt = new bitcoinjs.Psbt({ network: bitcoinjs.networks.testnet });
           var i; for ( i=0; i<selected_utxos.length; i++ ) {
                   psbt.addInput({
                        hash: selected_utxos[ i ][ "tx_id" ],
                        index: selected_utxos[ i ][ "output_number" ],
                        witnessUtxo: {
                                script: Buffer.from( '0014' + bitcoinjs.crypto.ripemd160( bitcoinjs.crypto.sha256( Buffer.from( selected_utxos[ i ][ "pubkey" ], "hex" ) ) ).toString( 'hex' ), 'hex' ),
                                value: selected_utxos[ i ][ "amount" ],
                        },
                   });
           }
           psbt.addOutput({
                        address: to_address,
                        value: to_amount,
           });
           psbt.addOutput({
                        address: change_address,
                        value: change_amount,
           });
           var keyPairSenders = [];
           var i; for ( i=0; i<selected_utxos.length; i++ ) {
                      keyPairSenders.push( ECPair.fromPrivateKey( Buffer.from( selected_utxos[ i ][ "privkey" ], "hex" ), bitcoinjs.networks.testnet ) );
           }
           var i; for ( i=0; i<keyPairSenders.length; i++ ) {
                      psbt.signInput( i, keyPairSenders[ i ] );
           }
           var i; for ( i=0; i<keyPairSenders.length; i++ ) {
//                      psbt.validateSignaturesOfInput( i );
           }
           psbt.finalizeAllInputs();
           return psbt.extractTransaction().toHex();
        } else {
                //do the part of step 11 where you create a raw bitcoin transaction, and do it without a change address
                var psbt = new bitcoinjs.Psbt({ network: bitcoinjs.networks.testnet });
           var i; for ( i=0; i<selected_utxos.length; i++ ) {
                   psbt.addInput({
                        hash: selected_utxos[ i ][ "tx_id" ],
                        index: selected_utxos[ i ][ "output_number" ],
                        witnessUtxo: {
                                script: Buffer.from( '0014' + bitcoinjs.crypto.ripemd160( bitcoinjs.crypto.sha256( Buffer.from( selected_utxos[ i ][ "pubkey" ], "hex" ) ) ).toString( 'hex' ), 'hex' ),
                                value: selected_utxos[ i ][ "amount" ],
                        },
                   });
           }
           psbt.addOutput({
                        address: to_address,
                        value: to_amount,
           });
           var keyPairSenders = [];
           var i; for ( i=0; i<selected_utxos.length; i++ ) {
                      keyPairSenders.push( ECPair.fromPrivateKey( Buffer.from( selected_utxos[ i ][ "privkey" ], "hex" ), bitcoinjs.networks.testnet ) );
           }
           var i; for ( i=0; i<keyPairSenders.length; i++ ) {
                      psbt.signInput( i, keyPairSenders[ i ] );
           }
           var i; for ( i=0; i<keyPairSenders.length; i++ ) {
//                      psbt.validateSignaturesOfInput( i );
           }
           psbt.finalizeAllInputs();
           return psbt.extractTransaction().toHex();
        }
}

function addUtxosToTx( amount_plus_fee, utxos_available_for_this_transaction, utxos_in_this_transaction, sats_per_byte, this_addition_is_being_done_because_of_a_change_address = false ) {   
        if ( !amount_plus_fee ) {
                return;   
        }
        var original_utxos_available_for_this_transaction = JSON.stringify( utxos_available_for_this_transaction );
        var original_utxos_in_this_transaction = JSON.stringify( utxos_in_this_transaction );
//        console.log( "amount plus fee:", amount_plus_fee );
//        console.log( "utxos available for this transaction:", utxos_available_for_this_transaction );
//        console.log( "utxos in this transaction:", utxos_in_this_transaction );
        //4. Check if there are any utxos in an array called utxos_available_for_this_transaction.
        if ( utxos_available_for_this_transaction.length < 1 ) {
                //if not, throw an error telling the user that they do not have enough money and to either top up their wallet or send a smaller amount.
                console.log( "You do not have enough money to send this transaction. Please top up your wallet or send a smaller amount." );
        } else {
                //5. Otherwise, add the utxo with the largest value as an input to the transaction and remove it from utxos_available_for_this_transaction. Also recalculate amount_plus_fee $
                var largest_utxo_value = 0;
                var largest_utxo_indexnum = 0;
                var i; for ( i=0; i<utxos_available_for_this_transaction.length; i++ ) {
                        if ( utxos_available_for_this_transaction[ i ][ "amount" ] > largest_utxo_value ) {
                                largest_utxo_value = utxos_available_for_this_transaction[ i ][ "amount" ];
                                largest_utxo_indexnum = i;
                        }
                }
//                console.log( "largest_utxo_indexnum", largest_utxo_indexnum );
//                console.log( "value of largest utxo", utxos_available_for_this_transaction[ largest_utxo_indexnum ][ "amount" ] );
                utxos_in_this_transaction.push( utxos_available_for_this_transaction.splice( largest_utxo_indexnum, 1 )[ 0 ] );
                amount_plus_fee = amount_plus_fee + ( 50 * sats_per_byte );
//                console.log( "the new amount_plus_fee, accounting for the new inputs, is", amount_plus_fee );
                //6. If the input added in the previous step is the first input to this transaction, treat it as if it was part of a set of multiple inputs.
//                console.log( "number of utxos in this transaction", utxos_in_this_transaction.length );
                //7. Check if the sum of the values of each input in the set of inputs is greater than or equal to amount_plus_fee.
                var sum_of_the_values_of_each_input_to_this_transaction = 0;
                var i; for ( i=0; i<utxos_in_this_transaction.length; i++ ) {
//                        console.log( "utxo in this transaction whose value we are currently checking so we can sum up the total value of all utxos in this transaction and check if it is g$
//                        console.log( "current utxo", utxos_in_this_transaction[ i ] );
//                        console.log( "amount of current utxo", utxos_in_this_transaction[ i ][ "amount" ] );
                        sum_of_the_values_of_each_input_to_this_transaction = sum_of_the_values_of_each_input_to_this_transaction + utxos_in_this_transaction[ i ][ "amount" ];
//                        console.log( "the sum of the values of each input to this transaction is", sum_of_the_values_of_each_input_to_this_transaction );
                }
                if ( sum_of_the_values_of_each_input_to_this_transaction < amount_plus_fee ) {
//                        console.log( "the sum of the values of each input to this transaction, i.e.", sum_of_the_values_of_each_input_to_this_transaction, "was less than the amount we nee$
                        //If the check in step 7 returns false, repeat steps 4-8 until the check in step 7 returns true or until step 4 throws an error.
                        return addUtxosToTx( amount_plus_fee, utxos_available_for_this_transaction, utxos_in_this_transaction, sats_per_byte, false );
                } else {
                        if ( !this_addition_is_being_done_because_of_a_change_address ) {
                                //9. If the check in step 7 returns true, check if there is change left over and it is greater than or equal to ( 250 + 50*sats_per_byte ) sats (this number $
                                var change_amount = sum_of_the_values_of_each_input_to_this_transaction - amount_plus_fee;
//                                console.log( "the sum of the values of each input to this transaction is", sum_of_the_values_of_each_input_to_this_transaction );
//                                console.log( "amount plus fee", amount_plus_fee );
//                                console.log( "the change amount should be the first number minus the second number, i.e.", change_amount );
//                                console.log( "there is change left over, namely", change_amount, "-- so we have to check if that is more than the dust limit" );
                                if ( change_amount >= ( 250 + 50 * sats_per_byte ) ) {
//                                        console.log( "the change amount --", change_amount, "-- is more than the dust limit, which is 250 + 50 * sats_per_byte i.e.", ( 250 + 50 * sats_per$
                                        //10. If the check in step 9 returns true, add a change address as an output whose value is equal to whatever value you got in step 9 and redo steps $
                                        var we_need_a_change_address = true;
                                        new_amount_plus_fee = amount_plus_fee + ( 50*sats_per_byte );
//                                        console.log( "original utxos available:", JSON.parse( original_utxos_available_for_this_transaction ) );
//                                        console.log( "original utxos in this tx:", JSON.parse( original_utxos_in_this_transaction ) );
                                        return addUtxosToTx( new_amount_plus_fee, JSON.parse( original_utxos_available_for_this_transaction ), JSON.parse( original_utxos_in_this_transaction ), sats_per_byte, true );
                                } else {
                                        var we_need_a_change_address = false;
                                }
//                                console.log( "sum of the values of each input to this transaction", sum_of_the_values_of_each_input_to_this_transaction );
//                                console.log( "amount_plus_fee", amount_plus_fee );
//                                console.log( "change_amount", change_amount );
                                var array = [];
                                array[ 0 ] = utxos_available_for_this_transaction;
                                array[ 1 ] = utxos_in_this_transaction;
                                array[ 2 ] = amount_plus_fee;
                                array[ 3 ] = change_amount;
                                array[ 4 ] = "the next field is true if we need a change address";
                                array[ 5 ] = this_addition_is_being_done_because_of_a_change_address;
                                return array;
                        } else {
                                var change_amount = sum_of_the_values_of_each_input_to_this_transaction - amount_plus_fee;
                                var array = [];
                                array[ 0 ] = utxos_available_for_this_transaction;
                                array[ 1 ] = utxos_in_this_transaction;
                                array[ 2 ] = amount_plus_fee;
                                array[ 3 ] = change_amount;
                                array[ 4 ] = "the next field is true if we need a change address";
                                array[ 5 ] = this_addition_is_being_done_because_of_a_change_address;
                                return array;
                        }
                }
        }
}

async function sendFromUtxoSetToAddress( toamount, toaddress, sats_per_byte, utxos_available_for_this_transaction, utxos_in_this_transaction ) {
//        console.log( "to amount", toamount );
//        console.log( "sats per byte", sats_per_byte );
        var amount_plus_fee = toamount + ( 150 * sats_per_byte );
//        console.log( "amount_plus_fee", amount_plus_fee );
        var original_utxos_available_for_this_transaction = JSON.stringify( utxos_available_for_this_transaction );
        var original_utxos_in_this_transaction = JSON.stringify( utxos_in_this_transaction );
        var array = addUtxosToTx( amount_plus_fee, utxos_available_for_this_transaction, utxos_in_this_transaction, sats_per_byte, false );
        if ( !array ) {
                return;
        }
        var adjusted_utxos_available_for_this_transaction = array[ 0 ];
        var adjusted_utxos_in_this_transaction = array[ 1 ];
        amount_plus_fee = array[ 2 ];
        if ( array[ 5 ] ) {
                var change_amount = array[ 3 ];
//                console.log( "change_amount", change_amount );
                var change_address = await getFirstUnusedChangeAddress();
        } else {
                var change_amount = 0;
                var change_address = "none";
        }
//        console.log( "adjusted_utxos_available_for_this_transaction", adjusted_utxos_available_for_this_transaction );
//        console.log( "adjusted_utxos_in_this_transaction", adjusted_utxos_in_this_transaction );
//        console.log( "amount_plus_fee", amount_plus_fee );
        var txhex = craftTransaction( adjusted_utxos_in_this_transaction, toamount, toaddress, change_address, change_amount, sats_per_byte );
//        console.log( txhex );
        if ( !txhex ) return;
        var tx = bitcoinjs.Transaction.fromHex( txhex );
        var virtual_bytes = tx.virtualSize();
        var real_fee = virtual_bytes * sats_per_byte;
        var new_amount_plus_fee = toamount + real_fee;
//        console.log( "now I will check what the original utxos available are" );
//        console.log( original_utxos_available_for_this_transaction );
//        console.log( JSON.parse( original_utxos_available_for_this_transaction ) );
//        console.log( "I will also check what the original utxos in the transaction are", JSON.parse( original_utxos_in_this_transaction ) );
        var new_array = addUtxosToTx( new_amount_plus_fee, JSON.parse( original_utxos_available_for_this_transaction ), JSON.parse( original_utxos_in_this_transaction ), sats_per_byte, false );
        var new_adjusted_utxos_available_for_this_transaction = new_array[ 0 ];
        var new_adjusted_utxos_in_this_transaction = new_array[ 1 ];
        new_amount_plus_fee = new_array[ 2 ];
        var new_change_amount = new_array[ 3 ];
        var new_txhex = craftTransaction( new_adjusted_utxos_in_this_transaction, toamount, toaddress, change_address, new_change_amount, sats_per_byte );
//        console.log( new_txhex );
        var new_tx = bitcoinjs.Transaction.fromHex( new_txhex );
        var new_virtual_bytes = tx.virtualSize();
        if ( new_virtual_bytes == virtual_bytes ) {
//                console.log( "yay! The transaction is ready and here is its hex:", new_txhex );
                return new_txhex;
                //do not use this yet because we are only at step 13: pushBTCpmt( new_txhex );
        } else {
                console.log( "I tried to craft your transaction twice and I kept getting errors. Please contact the developer of this wallet for assistance." );
        }
}

async function syncUtxosOnLoop() {
        await checkAddresses();
        syncUtxosOnLoop();
}
syncUtxosOnLoop();

var sendResponse = ( response, data, statusCode ) => {
  response.setHeader( 'Access-Control-Allow-Origin', '*' );
  response.setHeader( 'Access-Control-Request-Method', '*' );
  response.setHeader( 'Access-Control-Allow-Methods', 'OPTIONS, GET' );
  response.setHeader( 'Access-Control-Allow-Headers', '*' );
  response.writeHead( statusCode );
  response.end( data );
};

var collectData = ( request, callback ) => {
  var data = '';
  request.on( 'data', ( chunk ) => {
    data += chunk;
  });
  request.on( 'end', () => {
    callback( data );
  });
};

const requestListener = async function( request, response ) {
  var parts = url.parse( request.url, true );
  var gets = parts.query;
  var password = gets.password;
  if ( password != global_password ) {
        sendResponse( response, "wrong password", 200, {'Content-Type': 'text/plain'} );
        return;
  }
  if ( parts.path.startsWith( "/newaddress" ) ) {
        var first_unused_address = await getFirstUnusedAddress();
        sendResponse( response, first_unused_address, 200, {'Content-Type': 'text/plain'} );
  } else {
        var to_address = gets.address;
        var dbtext = fs.readFileSync( "db.txt" ).toString();
        var db = JSON.parse( dbtext );
        var current_time = Math.floor( Date.now() / 1000 );
        var current_time_plus_24_hours = Number( current_time ) + 86400;
        db.forEach( function( item, index ) {
                if ( current_time > item[ 1 ] ) {
                        db.splice( index, 1 );
                }
        });
        var i; for ( i=0; i<db.length; i++ ) {
            console.log( "address I've already sent money to:", db[ i ][ 0 ] );
            console.log( "address I'm asked to send money to:", to_address );
            console.log( "I should ignore the request, right?", db[ i ][ 0 ] == to_address || !db[ i ][ 0 ] || !to_address || db[ i ][ 0 ] == "undefined" || to_address == "undefined" );
            if ( db[ i ][ 0 ] == to_address || !db[ i ][ 0 ] || !to_address ) {
                return;
            }
        }
        //  console.log( to_address );
        var sats_per_byte = 1;
        var amount_to_send = Number( gets.amount );
        var amount_plus_fee = amount_to_send + ( 150 * sats_per_byte );
        //  console.log( "the amount plus the mining fee -- assuming no inputs -- is", amount_plus_fee );
        var utxos_to_put_in = JSON.parse( localStorage.content[ "utxos" ] );
        var utxos_to_get_out = [];
        var txhex = await sendFromUtxoSetToAddress( amount_to_send, to_address, sats_per_byte, utxos_to_put_in, utxos_to_get_out );
        if ( !txhex ) return;
        var request = await pushBTCpmt( txhex.toString() );
        var newitem = [];
        newitem.push( to_address );
        newitem.push( current_time_plus_24_hours );
        db.push ( newitem );
        var texttowrite = JSON.stringify( db );
        fs.writeFileSync( "db.txt", texttowrite, function() {return;});
        sendResponse( response, request, 200, {'Content-Type': 'text/plain'} );
  }
};

const server = http.createServer( requestListener );
server.listen( 8087 );
