@FR-08
Feature: Changing a job's status
  As the owner,
  I want the board to take only the status changes that make sense,
  so that a job's status always says where I really am with it.

  Scenario Outline: A job can go from <from> to <to>
    Given a job is <from>
    When I change it to <to>
    Then the change succeeds
    And the job is <to>

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

  Scenario Outline: A job can't go from <from> to <to>
    Given a job is <from>
    When I change it to <to>
    Then the change is refused as not allowed
    And the job is still <from>

    Examples:
      | from         | to           |
      | New          | Interviewing |
      | Saved        | New          |
      | Applied      | Saved        |
      | Interviewing | Applied      |
      | Offer        | Rejected     |
      | Rejected     | Applied      |
      | Dismissed    | Saved        |
