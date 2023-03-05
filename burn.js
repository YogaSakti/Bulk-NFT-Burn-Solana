const { PublicKey, Keypair, Connection, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const { PROGRAM_ID, Metadata, createBurnNftInstruction } = require('@metaplex-foundation/mpl-token-metadata')
const { programs, actions, NodeWallet } = require('@metaplex/js');
const { Metaplex, keypairIdentity, BundlrStorageDriver, toMetaplexFile } = require('@metaplex-foundation/js');
const { TOKEN_PROGRAM_ID, createBurnCheckedInstruction, createCloseAccountInstruction, getOrCreateAssociatedTokenAccount, createMintToInstruction } = require('@solana/spl-token')
const bs58 = require('bs58');

const connection = new Connection('https://rpc.ankr.com/solana', 'confirmed');
const metaplex = new Metaplex(connection);

const timeout = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let wallets = require('./solana.json');
// [
//  {
//     "address": "",
//     "privateKey": "",
//     "secretKey": "[]"
//  }
// ]


const SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const METAPLEX_TOKEN_METADATA_PROGRAM_ID = PROGRAM_ID
const UPDATE_AUTHORITY = new PublicKey('4ZCiGakZJy5aJsLpMBNBNwyrmNCCSCzukzhaPzzd4d7v');

const getTokenWallet = (wallet, mint) => PublicKey.findProgramAddressSync([wallet.toBuffer(), METAPLEX_TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()], METAPLEX_TOKEN_METADATA_PROGRAM_ID)[0];

const getOwnedNft = async (owner) => {
    const findAll = await metaplex.nfts().findAllByOwner({ owner });
    let nfts = await Promise.all(findAll.map((nft) => metaplex.nfts().load({ metadata: nft, tokenOwner: owner }).then((n) => n).catch((e) => console.log(e.tittle))));
    nfts = nfts.filter((nft) => nft.updateAuthorityAddress.toBase58() == UPDATE_AUTHORITY.toBase58());

    return nfts;
}

const burnNFT = async (conn, treasuryKeypair, nftObj) => {
    try {
        const wallet = new NodeWallet(treasuryKeypair);
        const tokenWallet = getTokenWallet(wallet.publicKey, nftObj.mint.address);
        console.log('Token Wallet:', tokenWallet.toString(), 'Treasury:', treasuryKeypair.publicKey.toString(), 'Token:', nftObj.mint.address.toString(), 'Metadata:', nftObj.metadataAddress.toString(), 'Edition:', nftObj.edition.address.toString());

        const { blockhash } = await conn.getLatestBlockhash('finalized')
        const burnAndClose = new Transaction({
            recentBlockhash: blockhash,
            // the buyer pays the transaction fee
            feePayer: treasuryKeypair.publicKey
        })

        const burnNFTIx = createBurnNftInstruction({
            metadata: nftObj.metadataAddress,
            owner: wallet.publicKey,
            mint: nftObj.mint.address,
            tokenAccount: tokenWallet,
            masterEditionAccount: nftObj.edition.address,
            splTokenProgram: SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID,
            collectionMetadata: nftObj.collection.address
        });
        
        burnAndClose.add(burnNFTIx);
        const burnAndCloseTx = await sendAndConfirmTransaction(connection, burnAndClose, [treasuryKeypair]);

        const returnArrayPacket = {
            Success: true,
            burnNFT: burnAndCloseTx
        }

        return returnArrayPacket;
    } catch (err) {
        console.error(err);
        const returnArrayPacket = {
            Success: false,
            burnNFT: ''
        }
        
        return returnArrayPacket;
    }
}

const runCriticalTX = async (conn, treasuryKeypair, nftsToUpdate) => {
    let receivableImploded = nftsToUpdate;
    let returnObj;
    while (receivableImploded.length > 0) {
        const failedArray = []
        let delay = 0;
        await Promise.all(receivableImploded.map(async (nftObj) => {
            await timeout(delay++ * 15);
            const returnArrayPacket = await burnNFT(conn, treasuryKeypair, nftObj);
            if (returnArrayPacket.Success) {
                console.log('Successfully burned NFT');
                returnObj = returnArrayPacket.burnNFT;
            } else if (!returnArrayPacket.Success) {

                failedArray.push(nftObj);
                console.log('Failed to burn');
            }

        }));
        receivableImploded = failedArray;
        console.log('Failed to burn:', receivableImploded.length);
        await timeout(10000);
    }

    console.log('Succeeded, generated:', returnObj);
}


(async () => {
    console.log(`Processing ${wallets.length} wallets`);
    for (let i = 0; i < wallets.length; i++) {
        const wallet = wallets[i]
        
        const owner = new PublicKey(wallet.address);
        const treasuryKeypair = Keypair.fromSecretKey(bs58.decode(wallet.privateKey))
        let nftsByOwner = await getOwnedNft(owner);

        console.log(`Burning ${nftsByOwner.length} NFTs Owned by Public Key:`, treasuryKeypair.publicKey.toString());
        
        await runCriticalTX(connection, treasuryKeypair, nftsByOwner);
    }
})()
