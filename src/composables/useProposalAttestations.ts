import {
  Attestation,
  Attestations,
  Proposal,
  Vote
} from '@/helpers/interfaces';
import { ATTESTAIONS_QUERY } from '@/helpers/queries';
import { WEIGHTED_VOTING_PROPOSAL_SCHEMA_UID } from '@/helpers/attest';

export function useProposalAttestations(proposal: Proposal) {
  const { apolloQuery } = useApolloQuery();

  const loadingAttestations = ref(false);
  const attestation = ref<Vote | null>(null);

  async function _fetchAttestations() {
    return apolloQuery(
      {
        context: {
          uri: 'https://optimism-goerli-bedrock.easscan.org/graphql'
        },
        query: ATTESTAIONS_QUERY,
        variables: {
          proposalID: proposal.id,
          schemaID: WEIGHTED_VOTING_PROPOSAL_SCHEMA_UID
        }
      },
      'attestations'
    );
  }

  function formatAttestations(attestations: Attestations): Vote | null {
    if (!attestations?.length) return null;

    const firstItemTime = attestations[0].time;
    const items: Attestations = [];

    for (const item of attestations) {
      if (item.time !== firstItemTime) break;
      items.push(item);
    }

    console.log({ items });

    return items.reduce(
      (acc, attest) => {
        const { attester, decodedDataJson } = attest;
        const data = JSON.parse(decodedDataJson) as Array<Attestation>;
        const [, { value: name }, { value }] = data;
        console.log({ data });
        acc.voter = attester;
        acc.choice[name.value] = value.value;
        return acc;
      },
      { choice: {}, reason: '', scores: [1], balance: 1 } as Vote
    );
  }

  async function loadAttestations() {
    if (loadingAttestations.value) return;

    loadingAttestations.value = true;
    try {
      const response = await _fetchAttestations();

      attestation.value = formatAttestations(response);
    } catch (e) {
      console.log(e);
    } finally {
      loadingAttestations.value = false;
    }
  }

  return {
    attestation,
    loadAttestations
  };
}
