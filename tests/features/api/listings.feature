@FR-16
Feature: Sending listings to a run
  As the owner,
  I want each run to be told which of its listings are new to the board,
  so that its summary names only the jobs I haven't seen yet.

  The listings in these scenarios come from the free job feeds, unless a scenario says LinkedIn.

  Scenario: A run is told how many listings were new and how many were seen before
    Given an earlier run received "Senior Dispatcher" and "Lead Nurse"
    When a later run receives "Senior Dispatcher", "Lead Nurse" and "Test Architect"
    Then the run is told it received 3 listings: 1 new and 2 seen again
    And the new job it is told about is "Test Architect"

  @FR-18
  Scenario: A LinkedIn job a search finds again is seen again, not new
    Given an earlier run received the LinkedIn job "Senior Dispatcher"
    When a later run receives the LinkedIn job "Senior Dispatcher"
    Then the run is told it received 1 listing: 0 new and 1 seen again

  @NFR-09
  Scenario: More than 25 listings at once are refused
    Given a run has started
    When the run is sent 26 listings at once
    Then the listings are refused with an explanation
    And the board has no jobs

  @NFR-09
  Scenario: A listing without a title is refused
    Given a run has started
    When the run is sent a listing without a title
    Then the listings are refused with an explanation
    And the board has no jobs
