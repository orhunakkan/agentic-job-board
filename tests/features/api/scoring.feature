@FR-06
Feature: Scoring jobs
  As the owner,
  I want every job scored against my profile, with a label and a reason,
  so that the best matches are at the top of the board.

  Scenario: A stored score shows on the job with its label, its reason and its rubric
    Given the board has a job "Senior Dispatcher"
    When a run scores "Senior Dispatcher" 82 with match-v2, because "Strong match on the dispatch skills."
    Then the scores are stored
    And "Senior Dispatcher" has the score 82, labelled Strong, because "Strong match on the dispatch skills."
    And "Senior Dispatcher" was scored with match-v2

  Scenario: A label that doesn't match the score is refused
    Given the board has a job "Senior Dispatcher"
    When a run scores "Senior Dispatcher" 80 but labels it Weak
    Then the scores are refused with an explanation
    And "Senior Dispatcher" is still unscored

  Scenario: Scores for a job that doesn't exist are refused, and none is stored
    Given the board has a job "Senior Dispatcher"
    When a run scores "Senior Dispatcher" and a job that doesn't exist
    Then the scores are refused, naming the job that doesn't exist
    And "Senior Dispatcher" is still unscored

  @FR-20
  Scenario: The scoring queue names the rubric each job needs
    Given the board has these jobs:
      | title       | description               |
      | Senior Dispatcher | Lead the dispatch team. |
      | Lead Nurse     |                           |
    When I ask which jobs need a score
    Then the queue holds:
      | job         | rubric    |
      | Senior Dispatcher | match-v2  |
      | Lead Nurse     | triage-v2 |
