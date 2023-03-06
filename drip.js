const bs58 = require('bs58');
const { Connection, Keypair, PublicKey, sendAndConfirmTransaction, SystemProgram, Transaction } = require('@solana/web3.js');
const { Metaplex } = require('@metaplex-foundation/js');
const FROM_KEY_PAIR = Keypair.fromSecretKey(bs58.decode('')) // your master private key

let wallets = require('./solana.json');

const NUM_DROPS_PER_TX = 10
const TX_INTERVAL = 1000

const connection = new Connection('https://rpc.ankr.com/solana', 'max');
const metaplex = new Metaplex(connection);

const getOwnedNft = async (owner) => {
    const findAll = await metaplex.nfts().findAllByOwner({ owner });
    let nfts = await Promise.all(findAll.map((nft) => metaplex.nfts().load({ metadata: nft, tokenOwner: owner }).then((n) => n).catch((e) => console.log(e.tittle))));
  
    //const UPDATE_AUTHORITY = new PublicKey('4ZCiGakZJy5aJsLpMBNBNwyrmNCCSCzukzhaPzzd4d7v'); // update authority of nft that you want to burn
    //nfts = nfts.filter((nft) => nft.updateAuthorityAddress.toBase58() == UPDATE_AUTHORITY.toBase58()); // enable this if you want to filter it

    return nfts;
}

const generateTransactions = (batchSize, dropList, fromWallet) => {
    let result = []
    let txInstructions = dropList.map((drop) => SystemProgram.transfer({
        fromPubkey: fromWallet,
        toPubkey: new PublicKey(drop.walletAddress),
        lamports: drop.numLamports
    }))
    const numTransactions = Math.ceil(txInstructions.length / batchSize)
    for (let i = 0; i < numTransactions; i++) {
        let bulkTransaction = new Transaction()
        let lowerIndex = i * batchSize
        let upperIndex = (i + 1) * batchSize
        for (let j = lowerIndex; j < upperIndex; j++) {
            if (txInstructions[j]) bulkTransaction.add(txInstructions[j])
        }
        result.push(bulkTransaction)
    }
    
    return result
}
  
const executeTransactions = async (transactionList, payer) => {
    let result = []
    let staggeredTransactions = transactionList.map((transaction, i, allTx) => new Promise((resolve) => {
        setTimeout(
            () => {
                console.log(`Requesting Transaction ${i + 1}/${allTx.length}`)          
                connection.getLatestBlockhash()
                .then((recentHash) => transaction.recentBlockhash = recentHash.blockhash)
                .then(() => sendAndConfirmTransaction(connection, transaction, [payer])).then(resolve)
            },
            i * TX_INTERVAL
          )
    }))
    result = await Promise.allSettled(staggeredTransactions)
    
    return result
}

(async () => {

    wallets.map((x) => console.log(x.privateKey))
    console.log(`Processing ${wallets.length} wallets`);
    const dropList = []
    for (let i = 0; i < wallets.length; i++) {
        const wallet = wallets[i]
        
        const owner = new PublicKey(wallet.address);
        const treasuryKeypair = Keypair.fromSecretKey(bs58.decode(wallet.privateKey))
        let nftsByOwner = await getOwnedNft(owner);
        if (nftsByOwner.length >= 1) {
            console.log(`[${i}] Burning ${nftsByOwner.length} NFTs Owned by Public Key:`, treasuryKeypair.publicKey.toString());
            dropList.push({
                walletAddress: treasuryKeypair.publicKey.toString(),
                numLamports: 1000000
            })
        }
    }

    console.log(`Initiating SOL drop from ${FROM_KEY_PAIR.publicKey.toString()}`)
    const transactionList = generateTransactions(
      NUM_DROPS_PER_TX,
      dropList,
      FROM_KEY_PAIR.publicKey
    )
    const txResults = await executeTransactions(
      transactionList,
      FROM_KEY_PAIR
    )
    console.log(txResults)
})()
