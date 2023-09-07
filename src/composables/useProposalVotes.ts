import {
  Attestation,
  Attestations,
  Proposal,
  Vote,
  VoteFilters
} from '@/helpers/interfaces';
import { ATTESTAIONS_QUERY, VOTES_QUERY } from '@/helpers/queries';
import { clone } from '@snapshot-labs/snapshot.js/src/utils';
import { WEIGHTED_VOTING_PROPOSAL_SCHEMA_UID } from '@/helpers/attest';

type QueryParams = {
  voter?: string;
} & Partial<VoteFilters>;

export function useProposalVotes(proposal: Proposal, loadBy = 6) {
  const { profiles, loadProfiles } = useProfiles();
  const { apolloQuery } = useApolloQuery();
  const { resolveName } = useResolveName();

  const loadingVotes = ref(false);
  const loadingMoreVotes = ref(false);
  const votes = ref<Vote[]>([]);
  const userVote = ref<Vote | null>(null);

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

  function formatProposalVotes(votes: Vote[]) {
    if (!votes?.length) return [];
    return votes.map(vote => {
      vote.balance = vote.vp;
      vote.scores = vote.vp_by_strategy;
      return vote;
    });
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
  async function loadVotes(filter: Partial<VoteFilters> = {}) {
    if (loadingVotes.value) return;

    loadingVotes.value = true;
    try {
      const [response, attestationsResponse] = await Promise.all([
        _fetchVotes(filter),
        _fetchAttestations()
      ]);
      const formattedAttestations = formatAttestations(attestationsResponse);
      votes.value = formattedAttestations
        ? [formattedAttestations, ...formatProposalVotes(response)]
        : formatProposalVotes(response);
    } catch (e) {
      console.log(e);
    } finally {
      loadingVotes.value = false;
    }
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
      const response = await _fetchVote({ voter });
      userVote.value = formatProposalVotes(response)[0];
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
    loadSingleVote,
    loadUserVote
  };
}
