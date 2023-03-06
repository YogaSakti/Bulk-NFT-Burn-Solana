const bs58 = require('bs58');
const { PublicKey, Keypair, Connection, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const { PROGRAM_ID, Metadata, createBurnNftInstruction, PROGRAM_ADDRESS } = require('@metaplex-foundation/mpl-token-metadata')
const { programs, actions, NodeWallet } = require('@metaplex/js');
const { Metaplex, keypairIdentity, BundlrStorageDriver, toMetaplexFile } = require('@metaplex-foundation/js');
const { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createBurnCheckedInstruction, createCloseAccountInstruction, getOrCreateAssociatedTokenAccount, createMintToInstruction } = require('@solana/spl-token')

const connection = new Connection('https://rpc.ankr.com/solana', 'max');
const metaplex = new Metaplex(connection);

// eslint-disable-next-line no-promise-executor-return
const timeout = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let wallets = require('./solana.json');

// i'am cant get collection metadata address for now, so i set it manually
const COLLECTION_METADATA = new PublicKey('3CBF1bzb5fxmzCwj2dyS3Q8UeYCdfShb5fLYkYU6daRs')

const getTokenAccount = (wallet, mint) => PublicKey.findProgramAddressSync([wallet.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];

const getOwnedNft = async (owner) => {
    const findAll = await metaplex.nfts().findAllByOwner({ owner });
    let nfts = await Promise.all(findAll.map((nft) => metaplex.nfts().load({ metadata: nft, tokenOwner: owner }).then((n) => n).catch((e) => console.log(e.tittle))));
    
    // const UPDATE_AUTHORITY = new PublicKey('4ZCiGakZJy5aJsLpMBNBNwyrmNCCSCzukzhaPzzd4d7v'); // update authority of nft that you want to burn
    // nfts = nfts.filter((nft) => nft.updateAuthorityAddress.toBase58() == UPDATE_AUTHORITY.toBase58()); // enable this if you want to filter it

    return nfts;
}


const burnNFT = async (conn, treasuryKeypair, nftObj) => {
    try {
        const wallet = new NodeWallet(treasuryKeypair);
        const ownerAddress = wallet.publicKey;
        const tokenAccount = getTokenAccount(wallet.publicKey, nftObj.mint.address);
        const { metadataAddress } = nftObj;
        const { address: mintAddress } = nftObj.mint
        const { address: editionAddress } = nftObj.edition

        // console.log('Token Wallet:', tokenAccount.toString(), 'Treasury:', treasuryKeypair.publicKey.toString(), 'Token:', nftObj.mint.address.toString(), 'Metadata:', nftObj.metadataAddress.toString(), 'Edition:', nftObj.edition.address.toString());

        const burnAndClose = new Transaction({
            feePayer: ownerAddress
        })

        const txData = {
            metadata: metadataAddress,
            owner: ownerAddress,
            mint: mintAddress,
            tokenAccount,
            masterEditionAccount: editionAddress,
            splTokenProgram: TOKEN_PROGRAM_ID,
            collectionMetadata: COLLECTION_METADATA
        }

        const burnNFTIx = createBurnNftInstruction(txData, new PublicKey(PROGRAM_ADDRESS));
        burnAndClose.add(burnNFTIx);
        // const burnAndCloseTx = await sendAndConfirmTransaction(connection, burnAndClose, [treasuryKeypair], { commitment: 'max' });
        const burnAndCloseTx = await connection.sendTransaction(burnAndClose, [treasuryKeypair], { preflightCommitment: 'finalized' });

        const returnArrayPacket = {
            Success: true,
            burnNFT: burnAndCloseTx
        }

        return returnArrayPacket;
    } catch (err) {
        console.log(err);
        const returnArrayPacket = {
            Success: false,
            burnNFT: 'Error'
        }
        
        return returnArrayPacket;
    }
}

const runCriticalTX = async (conn, treasuryKeypair, nftsToUpdate) => {
    let receivableImploded = nftsToUpdate;
    while (receivableImploded.length > 0) {
        const failedArray = []
        let delay = 0;
        await Promise.all(receivableImploded.map(async (nftObj) => {
            await timeout(delay++ * 15);
            const returnArrayPacket = await burnNFT(conn, treasuryKeypair, nftObj);
            if (returnArrayPacket.Success) {
                console.log(`Successfully burned NFT - ${nftObj.json.name} - ${returnArrayPacket.burnNFT}`);
            } else if (!returnArrayPacket.Success) {

                failedArray.push(nftObj);
                console.log(`Failed to burn - ${nftObj.json.name}`);
            }

        }));
        receivableImploded = failedArray;
        console.log('Total Failed to burn:', receivableImploded.length);
        await timeout(5000);
    }
    console.log(`Successfully burned ${nftsToUpdate.length} NFTs`);
}


(async () => {
    console.log(`Processing ${wallets.length} wallets`);
    for (let i = 0; i < wallets.length; i++) {
        const wallet = wallets[i]
        
        const owner = new PublicKey(wallet.address);
        const treasuryKeypair = Keypair.fromSecretKey(bs58.decode(wallet.privateKey))
        let nftsByOwner = await getOwnedNft(owner);
        if (nftsByOwner.length >= 1) {
            console.log(`[${i}] Burning ${nftsByOwner.length} NFTs Owned by Public Key:`, treasuryKeypair.publicKey.toString());
        
            await runCriticalTX(connection, treasuryKeypair, nftsByOwner);
        }
    }
})()
