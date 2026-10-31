/**
 * Domain cases the dashboard can hand to a live agent. Each task carries a
 * deadline and what it is worth to the business; the agent decides what to
 * bid (or to skip) against the live surge price.
 */
import type { Task } from './llmAgent'

export interface AgentCase { id: string, title: string, brief: string, tasks: Task[] }
export interface Domain { id: string, name: string, cases: AgentCase[] }

export const DOMAINS: Domain[] = [
  {
    id: 'finance',
    name: 'Finance',
    cases: [
      {
        id: 'fraud',
        title: 'Card fraud spike',
        brief: 'Fraud alerts are firing. Score flagged payments now; reporting can wait.',
        tasks: [
          { prompt: 'Score 40 flagged card transactions for fraud risk', deadlineSec: 30, valueSats: 800 },
          { prompt: 'Draft SMS alert for customers with blocked cards', deadlineSec: 120, valueSats: 300 },
          { prompt: 'Summarise this week\'s fraud trends for the risk team', deadlineSec: 3600, valueSats: 150 }
        ]
      },
      {
        id: 'earnings',
        title: 'Earnings day',
        brief: 'The call just ended. Traders want the summary before the market reacts.',
        tasks: [
          { prompt: 'Summarise the Q3 earnings call transcript', deadlineSec: 60, valueSats: 600 },
          { prompt: 'Extract forward guidance numbers into a table', deadlineSec: 300, valueSats: 350 },
          { prompt: 'Compare margins with the last four quarters', deadlineSec: 1800, valueSats: 200 }
        ]
      }
    ]
  },
  {
    id: 'healthcare',
    name: 'Healthcare',
    cases: [
      {
        id: 'triage',
        title: 'ER triage',
        brief: 'Ambulances inbound. Triage notes first, paperwork last.',
        tasks: [
          { prompt: 'Summarise incoming ambulance triage notes', deadlineSec: 20, valueSats: 900 },
          { prompt: 'Flag drug interactions in the admission medication list', deadlineSec: 120, valueSats: 500 },
          { prompt: 'Draft a discharge summary template', deadlineSec: 3600, valueSats: 150 }
        ]
      },
      {
        id: 'trial',
        title: 'Clinical trial screening',
        brief: 'Adverse events need review soon; screening and translation are routine.',
        tasks: [
          { prompt: 'Summarise new adverse-event reports', deadlineSec: 90, valueSats: 550 },
          { prompt: 'Screen 25 patient records against trial criteria', deadlineSec: 600, valueSats: 400 },
          { prompt: 'Translate the consent form to Spanish', deadlineSec: 7200, valueSats: 180 }
        ]
      }
    ]
  },
  {
    id: 'legal',
    name: 'Legal',
    cases: [
      {
        id: 'contract',
        title: 'Contract before signing',
        brief: 'The vendor signs in under a minute. Find the risky clauses now.',
        tasks: [
          { prompt: 'Flag risky clauses in the vendor MSA', deadlineSec: 45, valueSats: 700 },
          { prompt: 'Summarise the indemnity terms', deadlineSec: 300, valueSats: 300 },
          { prompt: 'Draft a cover note for the redline', deadlineSec: 1800, valueSats: 150 }
        ]
      },
      {
        id: 'discovery',
        title: 'E-discovery sweep',
        brief: 'Opposing counsel asked about the merger date; the rest is bulk review.',
        tasks: [
          { prompt: 'Find every mention of the merger date', deadlineSec: 120, valueSats: 450 },
          { prompt: 'Classify 50 emails as privileged or not', deadlineSec: 600, valueSats: 350 },
          { prompt: 'Build a timeline of key events', deadlineSec: 3600, valueSats: 200 }
        ]
      }
    ]
  },
  {
    id: 'logistics',
    name: 'Logistics',
    cases: [
      {
        id: 'port',
        title: 'Port closure',
        brief: 'A port just closed. Containers must be re-routed before the cut-off.',
        tasks: [
          { prompt: 'Re-route 12 containers around the port closure', deadlineSec: 30, valueSats: 850 },
          { prompt: 'Notify affected customers with new ETAs', deadlineSec: 180, valueSats: 350 },
          { prompt: 'Estimate the demurrage cost', deadlineSec: 1200, valueSats: 200 }
        ]
      },
      {
        id: 'lastmile',
        title: 'Last-mile planning',
        brief: 'Tomorrow\'s routes. Nothing is urgent, so the agent should wait for cheap slots.',
        tasks: [
          { prompt: 'Classify yesterday\'s failed-delivery reasons', deadlineSec: 300, valueSats: 250 },
          { prompt: 'Optimise tomorrow\'s 60-stop delivery route', deadlineSec: 900, valueSats: 300 },
          { prompt: 'Draft the morning driver briefing', deadlineSec: 3600, valueSats: 120 }
        ]
      }
    ]
  },
  {
    id: 'research',
    name: 'Research',
    cases: [
      {
        id: 'grant',
        title: 'Grant deadline tonight',
        brief: 'The portal closes soon. The abstract is the only thing that cannot slip.',
        tasks: [
          { prompt: 'Polish the grant abstract to 250 words', deadlineSec: 40, valueSats: 750 },
          { prompt: 'Check the budget justification for gaps', deadlineSec: 150, valueSats: 400 },
          { prompt: 'Suggest three suitable reviewers', deadlineSec: 1800, valueSats: 120 }
        ]
      },
      {
        id: 'review',
        title: 'Literature review',
        brief: 'Background reading for next month\'s paper. Value is low; cheap slots only.',
        tasks: [
          { prompt: 'Summarise the five newest papers on solid-state batteries', deadlineSec: 600, valueSats: 300 },
          { prompt: 'Extract reported energy densities into a table', deadlineSec: 900, valueSats: 250 },
          { prompt: 'Draft a related-work paragraph', deadlineSec: 3600, valueSats: 150 }
        ]
      }
    ]
  },
  {
    id: 'ecommerce',
    name: 'E-commerce',
    cases: [
      {
        id: 'flash',
        title: 'Flash sale launch',
        brief: 'The sale goes live in 30 seconds and the product titles are missing.',
        tasks: [
          { prompt: 'Write 20 product titles for the flash sale', deadlineSec: 30, valueSats: 700 },
          { prompt: 'Classify 100 reviews by sentiment', deadlineSec: 240, valueSats: 300 },
          { prompt: 'Translate the product page to German', deadlineSec: 1800, valueSats: 180 }
        ]
      },
      {
        id: 'support',
        title: 'Support backlog',
        brief: 'Angry refund tickets first; tagging and reports are routine.',
        tasks: [
          { prompt: 'Draft replies to 10 angry refund tickets', deadlineSec: 60, valueSats: 600 },
          { prompt: 'Tag 50 support tickets by topic', deadlineSec: 600, valueSats: 250 },
          { prompt: 'Summarise the top complaints this week', deadlineSec: 3600, valueSats: 150 }
        ]
      }
    ]
  }
]

export const findCase = (domainId: string, caseId: string): { domain: Domain, agentCase: AgentCase } | undefined => {
  const domain = DOMAINS.find(d => d.id === domainId)
  const agentCase = domain?.cases.find(c => c.id === caseId)
  return domain === undefined || agentCase === undefined ? undefined : { domain, agentCase }
}
