@FR-16
Feature: One job per listing
  As the owner,
  I want a listing that turns up again to stay the job I already have,
  so that I never look at the same job twice.

  The listings in these scenarios come from the free job feeds, unless a scenario says LinkedIn.

  Scenario: A new listing becomes one new job
    When a run receives "Senior Dispatcher"
    Then the board has 1 job
    And "Senior Dispatcher" is New and has been seen 1 time
    And "Senior Dispatcher" has 1 sighting

  Scenario: The same listing in a later run is seen again
    Given an earlier run received "Senior Dispatcher"
    When a later run receives "Senior Dispatcher"
    Then the board has 1 job
    And "Senior Dispatcher" has been seen 2 times
    And "Senior Dispatcher" was last seen by the later run
    And "Senior Dispatcher" has one sighting for each run

  Scenario: The same listing twice in one run adds one sighting
    When a run receives "Senior Dispatcher" twice
    Then the board has 1 job
    And "Senior Dispatcher" has been seen 1 time
    And "Senior Dispatcher" has 1 sighting

  @FR-18
  Scenario: A LinkedIn job the board already has stays one job
    Given the board has the LinkedIn job "Senior Logistics Coordinator" from an alert email
    When a LinkedIn search finds "Senior Logistics Coordinator" again
    Then the board has 1 job
    And "Senior Logistics Coordinator" is Saved and has been seen 2 times

  Scenario: The same job ID from two sources is two jobs
    When a run receives a Greenhouse listing and a Lever listing with the same job ID
    Then the board has 2 jobs
