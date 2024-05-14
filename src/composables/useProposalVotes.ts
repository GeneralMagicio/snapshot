import {
  Attestation,
  Attestations,
  ExtendedSpace,
  Proposal,
  Vote,
  VoteFilters
} from '@/helpers/interfaces';
import {
  ATTESTAIONS_QUERY,
  SINGLE_ATTESTAION_QUERY,
  VOTES_QUERY,
  VP_QUERY
} from '@/helpers/queries';
import { clone } from '@snapshot-labs/snapshot.js/src/utils';
import { WEIGHTED_VOTING_PROPOSAL_SCHEMA_UID } from '@/helpers/attest';
import { getAddress } from '@ethersproject/address';

type QueryParams = {
  voter?: string;
} & Partial<VoteFilters>;
interface VP {
  vp: number;
  vp_by_strategy: number[];
}
export function useProposalVotes(
  proposal: Proposal,
  loadBy = 6,
  space: ExtendedSpace
) {
  const { profiles, loadProfiles } = useProfiles();
  const { apolloQuery } = useApolloQuery();
  const { resolveName } = useResolveName();

  const loadingVotes = ref(false);
  const loadingSingleVote = ref(false);
  const loadingMoreVotes = ref(false);
  const votes = ref<Vote[]>([]);
  const userVote = ref<Vote | null>(null);
  const isWeighted = proposal.type === 'weighted';

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
  async function _fetchVP(queryParams: QueryParams) {
    return apolloQuery(
      {
        query: VP_QUERY,
        variables: {
          space: space.id,
          proposal: proposal.id,
          voter: queryParams.voter
        }
      },
      'vp'
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

  async function formatAttestations(
    attestations: Attestations
  ): Promise<Vote[]> {
    if (!attestations?.length) return [];

    const VisitedAttester = new Set<string>();

    const result: Vote[] = [];

    for (const attestation of attestations) {
      if (VisitedAttester.has(attestation.attester)) continue;
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
      const { vp, vp_by_strategy } = ((await _fetchVP({
        voter: attestation.attester
      })) as VP) || { vp: 1, vp_by_strategy: 1 };
      result.push({
        ipfs: attestation.id,
        voter: attestation.attester,
        choice: choice,
        reason: '',
        scores: vp_by_strategy,
        balance: vp,
        vp,
        vp_by_strategy,
        created: attestation.time,
        isAttestation: true
      });
    }

    return result;
  }
  async function loadVotes(filter: Partial<VoteFilters> = {}) {
    if (loadingVotes.value) return;
    loadingVotes.value = true;

    try {
      const response = await (isWeighted
        ? _fetchAttestations()
        : _fetchVotes(filter));

      const formattedVotes = isWeighted
        ? await formatAttestations(response)
        : formatProposalVotes(response);
      votes.value = formattedVotes;
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
      const formattedAttestations = await formatAttestations(
        attestationsResponse
      );
      return formattedAttestations;
    } catch (e) {
      console.log(e);
    } finally {
      loadingSingleVote.value = false;
    }
    return [];
  }
  async function loadSingleVote(search: string) {
    loadingVotes.value = true;

    const response = await resolveName(search);
    const voter = response || search;
    try {
      const response = await _fetchVote({ voter });
      votes.value = formatProposalVotes(response);
    } catch (e) {
      console.log(e);
    } finally {
      loadingVotes.value = false;
    }
  }

  async function loadMoreVotes(filter: Partial<VoteFilters> = {}) {
    if (loadingMoreVotes.value || loadingVotes.value) return;

    loadingMoreVotes.value = true;
    try {
      const response = await _fetchVotes(filter, votes.value.length);

      votes.value = votes.value.concat(formatProposalVotes(response));
    } catch (e) {
      console.log(e);
    } finally {
      loadingMoreVotes.value = false;
    }
  }

  async function loadUserVote(voter: string) {
    try {
      const response = await (isWeighted
        ? _loadUserAttestation(voter)
        : _fetchVote({ voter }));
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
    userPrioritizedVotes,
    profiles,
    loadingVotes,
    loadingMoreVotes,
    userVote,
    formatProposalVotes,
    loadVotes,
    loadMoreVotes,
    loadSingleVote: isWeighted ? _loadUserAttestation : loadSingleVote,
    loadUserVote
  };
}
