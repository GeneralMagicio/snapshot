import {
  SchemaRegistry,
  EAS,
  SchemaEncoder,
  AttestationRequestData
} from '@ethereum-attestation-service/eas-sdk';
import type { Web3Provider } from '@ethersproject/providers';
import type { Wallet } from '@ethersproject/wallet';
import { EASNetworks } from './constants';
import { calcPercentageOfSum } from '@snapshot-labs/snapshot.js/src/voting/quadratic';

export const WEIGHTED_VOTING_PROPOSAL_SCHEMA_UID =
  '0x30457fc9ddd2ce5cc0c8ae9ca5e327db7ec51ea2f766eb7067bbc2e16fbfb783';

export async function createWeightedVotingProposalSchema(
  web3: Web3Provider | Wallet
) {
  const signer = 'getSigner' in web3 ? web3.getSigner() : web3;
  const network = await signer.getChainId();
  const easConfig = EASNetworks[network];
  console.log({ easConfig, network });
  const schemaRegistryContractAddress = easConfig.SchemaRegistry;
  const schemaRegistry = new SchemaRegistry(schemaRegistryContractAddress);

  schemaRegistry.connect(signer as any);

  const schema = 'string choice, uint16 percent, bytes32 proposalId';
  // const resolverAddress: string = ZERO_ADDRESS;

  const revocable = true;

  const transaction = await schemaRegistry.register({
    schema,
    // resolverAddress,
    revocable
  });

  // Optional: Wait for transaction to be validated
  await transaction.wait();
}
export async function weightedVotingProposalAttest(
  proposalId: string,
  web3: Web3Provider | Wallet,
  data: Record<number, number>
) {
  console.log('proposalId: ', proposalId);
  console.log({ data });

  const signer = 'getSigner' in web3 ? web3.getSigner() : web3;
  // const signer = 'getSigner' in web3 ? web3.getSigner() : web3;
  // console.log({ signer });
  const network = await signer.getChainId();
  const easConfig = EASNetworks[network];
  const eas = new EAS(easConfig.EASDeployment);
  const schemaRegistry = new SchemaRegistry(easConfig.SchemaRegistry);

  // const _signer = {
  //   ...signer,
  //   signTypedData: signer._signTypedData
  // };
  //
  eas.connect(signer as any);
  schemaRegistry.connect(signer as any);

  const schema = await schemaRegistry.getSchema({
    uid: WEIGHTED_VOTING_PROPOSAL_SCHEMA_UID
  });
  const schemaEncoder = new SchemaEncoder(schema.schema);
  const selectedChoices: number[] = [];
  const weights: number[] = [];
  Object.entries(data).forEach(([choiceId, value]) => {
    selectedChoices.push(+choiceId);
    weights.push(+value);
  });
  const percentages = weights.map(weight =>
    Math.round(calcPercentageOfSum(weight * 10000, weights))
  );

  try {
    const multiAttestData = [true].map((): AttestationRequestData => {
      const encodedData = schemaEncoder.encodeData([
        {
          name: 'proposalId',
          type: 'bytes32',
          value: proposalId
        },
        { name: 'choices', type: 'uint8[]', value: selectedChoices },
        {
          name: 'percentages',
          type: 'uint16[]',
          value: percentages
        }
      ]);
      return {
        recipient: '0x0000000000000000000000000000000000000000',
        revocable: false, // Be aware that if your schema is not revocable, this MUST be false
        data: encodedData
      };
    });
    const tx = await eas.multiAttest([
      {
        schema: WEIGHTED_VOTING_PROPOSAL_SCHEMA_UID,
        data: multiAttestData
      }
    ]);
    console.log({ tx });
    const newAttestationUID = await tx.wait();
    return { id: newAttestationUID };
  } catch (e) {
    console.log('error on sending tx:', e);
  }
}
