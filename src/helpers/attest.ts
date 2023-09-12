import type { Web3Provider } from '@ethersproject/providers';
import type { Wallet } from '@ethersproject/wallet';
import { EASNetworks } from './constants';
import { calcPercentageOfSum } from '@snapshot-labs/snapshot.js/src/voting/quadratic';

export const WEIGHTED_VOTING_PROPOSAL_SCHEMA_UID =
  '0x30457fc9ddd2ce5cc0c8ae9ca5e327db7ec51ea2f766eb7067bbc2e16fbfb783';

export async function weightedVotingProposalAttest(
  proposalId: string,
  web3: Web3Provider | Wallet,
  data: Record<number, number>
) {
  const module = await import('@ethereum-attestation-service/eas-sdk');

  const signer = 'getSigner' in web3 ? web3.getSigner() : web3;

  const network = await signer.getChainId();
  const easConfig = EASNetworks[network];
  const eas = new module.EAS(easConfig.EASDeployment);
  const schemaRegistry = new module.SchemaRegistry(easConfig.SchemaRegistry);

  eas.connect(signer as any);
  schemaRegistry.connect(signer as any);

  const schema = await schemaRegistry.getSchema({
    uid: WEIGHTED_VOTING_PROPOSAL_SCHEMA_UID
  });
  const schemaEncoder = new module.SchemaEncoder(schema.schema);
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
    const multiAttestData = [true].map((): any => {
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

    const newAttestationUID = await tx.wait();
    return { id: newAttestationUID, ipfs: newAttestationUID };
  } catch (e) {
    console.log('error on sending tx:', e);
  }
}
