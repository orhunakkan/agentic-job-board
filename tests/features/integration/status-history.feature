@FR-08
Feature: Every status change is recorded
  As the owner,
  I want each change of a job's status written to its history,
  so that I can see how far I got with every job.

  Scenario Outline: A change from <from> to <to> writes one history row
    Given a job is <from>
    When I change it to <to>
    Then the job is <to>
    And its history gains one row, from <from> to <to>

    Examples:
      | from         | to           |
      | New          | Saved        |
      | New          | Applied      |
      | New          | Dismissed    |
      | Saved        | Applied      |
      | Saved        | Dismissed    |
      | Applied      | Interviewing |
      | Applied      | Rejected     |
      | Applied      | Dismissed    |
      | Interviewing | Offer        |
      | Interviewing | Rejected     |
      | Interviewing | Dismissed    |
      | Dismissed    | New          |

  Scenario: A change that isn't allowed leaves the job as it was
    Given a job is Saved
    When I change it to Offer
    Then the change is refused as not allowed
    And the job is still Saved
    And its history is unchanged
