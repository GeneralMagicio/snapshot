import {
  Attestation,
  Attestations,
  Proposal,
  Vote,
  VoteFilters
} from '@/helpers/interfaces';
import {
  ATTESTAIONS_QUERY,
  SINGLE_ATTESTAION_QUERY,
  VOTES_QUERY
} from '@/helpers/queries';
import { clone } from '@snapshot-labs/snapshot.js/src/utils';
import { WEIGHTED_VOTING_PROPOSAL_SCHEMA_UID } from '@/helpers/attest';
import { getAddress } from '@ethersproject/address';

type QueryParams = {
  voter?: string;
} & Partial<VoteFilters>;

export function useProposalVotes(proposal: Proposal, loadBy = 6) {
  const { profiles, loadProfiles } = useProfiles();
  const { apolloQuery } = useApolloQuery();
  const { resolveName } = useResolveName();

  const loadingVotes = ref(false);
  const loadingSingleVote = ref(false);
  const loadingMoreVotes = ref(false);
  const votes = ref<Vote[]>([]);
  const userVote = ref<Vote | null>(null);
  const attestations = ref<Vote[]>([]);

  const userPrioritizedVotes = computed(() => {
    const votesClone = clone(votes.value);
    if (userVote.value) {
      const index = votesClone.findIndex(
        vote => vote.ipfs === userVote.value?.ipfs
      );
      if (index !== -1) {
        votesClone.splice(index, 1);
      }
      votesClone.unshift(userVote.value);
    }

    return votesClone;
  });

  async function _fetchVotes(queryParams: QueryParams, skip = 0) {
    return apolloQuery(
      {
        query: VOTES_QUERY,
        variables: {
          id: proposal.id,
          first: loadBy,
          skip,
          orderBy: 'vp',
          orderDirection: queryParams.orderDirection || 'desc',
          reason_not: queryParams.onlyWithReason ? '' : undefined,
          voter: queryParams.voter || undefined
        }
      },
      'votes'
    );
  }

  async function _fetchVote(queryParams: QueryParams) {
    return apolloQuery(
      {
        query: VOTES_QUERY,
        variables: {
          id: proposal.id,
          voter: queryParams.voter
        }
      },
      'votes'
    );
  }
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

  async function _fetchSingleAttestation(attester: string) {
    return apolloQuery(
      {
        context: {
          uri: 'https://optimism-goerli-bedrock.easscan.org/graphql'
        },
        query: SINGLE_ATTESTAION_QUERY,
        variables: {
          proposalID: proposal.id,
          schemaID: WEIGHTED_VOTING_PROPOSAL_SCHEMA_UID,
          attester: getAddress(attester)
        }
      },
      'attestations'
    );
  }

  function formatProposalVotes(votes: Vote[]) {
    if (!votes?.length) return [];
    return votes.map(vote => {
      vote.balance = vote.vp;
      vote.scores = vote.vp_by_strategy;
      return vote;
    });
  }

  function formatAttestations(attestations: Attestations): Vote[] {
    if (!attestations?.length) return [];

    const VisitedAttester = new Set<string>();

    const result: Vote[] = [];

    attestations.forEach(attestation => {
      if (VisitedAttester.has(attestation.attester)) return;
      VisitedAttester.add(attestation.attester);

      const data = JSON.parse(
        attestation.decodedDataJson
      ) as Array<Attestation>;

      const choice = {};
      const choices: number[] = data[1].value.value as number[];
      const percentages: number[] = data[2].value.value as number[];
      choices.forEach((choiceId, index) => {
        choice[choiceId] = percentages[index];
      });
      result.push({
        ipfs: attestation.id,
        voter: attestation.attester,
        choice: choice,
        reason: '',
        scores: [1],
        balance: 1,
        vp: 1,
        vp_by_strategy: [1],
        created: attestation.time,
        isAttestation: true
      });
    });

    return result;
  }
  async function loadVotes(filter: Partial<VoteFilters> = {}) {
    if (loadingVotes.value) return;

    loadingVotes.value = true;
    try {
      const [response, attestationsResponse] = await Promise.all([
        _fetchVotes(filter),
        _fetchAttestations()
      ]);

      const formattedAttestations = formatAttestations(attestationsResponse);
      attestations.value = formattedAttestations;
      votes.value = [
        ...formattedAttestations
        // ...formatProposalVotes(response)
      ];
    } catch (e) {
      console.log(e);
    } finally {
      loadingVotes.value = false;
    }
  }

  async function _loadUserAttestation(search: string): Promise<Vote[]> {
    loadingSingleVote.value = true;

    const response = await resolveName(search);
    const voter = response || search;
    try {
      const attestationsResponse = await _fetchSingleAttestation(voter);
      const formattedAttestations = formatAttestations(attestationsResponse);
      return formattedAttestations;
    } catch (e) {
      console.log(e);
    } finally {
      loadingSingleVote.value = false;
    }
    return [];
  }

  async function loadMoreVotes(filter: Partial<VoteFilters> = {}) {
    // if (loadingMoreVotes.value || loadingVotes.value) return;
    //
    // loadingMoreVotes.value = true;
    // try {
    //   const response = await _fetchVotes(filter, votes.value.length);
    //
    //   votes.value = votes.value.concat(formatProposalVotes(response));
    // } catch (e) {
    //   console.log(e);
    // } finally {
    //   loadingMoreVotes.value = false;
    // }
  }

  async function loadUserVote(voter: string) {
    try {
      // const response = await _fetchVote({ voter });
      const response = await _loadUserAttestation(voter);
      userVote.value =
        response.length > 0 ? formatProposalVotes(response)[0] : null;
    } catch (e) {
      console.log(e);
    }
  }

  watch(userPrioritizedVotes, () => {
    loadProfiles(userPrioritizedVotes.value.map(vote => vote.voter));
  });

  return {
    votes,
    attestations,
    userPrioritizedVotes,
    profiles,
    loadingVotes,
    loadingMoreVotes,
    userVote,
    formatProposalVotes,
    loadVotes,
    loadMoreVotes,
    loadSingleVote: _loadUserAttestation,
    loadUserVote
  };
}
