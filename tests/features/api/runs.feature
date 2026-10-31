@FR-11
Feature: Run history
  As the owner,
  I want every finished run to report what it found,
  so that I can see at a glance what a search brought in.

  Scenario: A finished run reports its counts and its 5 best new jobs
    Given an earlier run received "Old Dispatcher"
    And a run has started
    And the run received these jobs:
      | title          | score |
      | Senior Dispatcher    | 91    |
      | Lead Nurse        | 72    |
      | Fleet Planner  | 85    |
      | Dispatcher II        | 40    |
      | Nurse Educator    | 66    |
      | Cashier        | 55    |
    When the run finishes
    Then the run reports 6 listings received, 6 new jobs, 0 seen again and 6 scored
    And its top new jobs are "Senior Dispatcher", "Fleet Planner", "Lead Nurse", "Nurse Educator" and "Cashier", in that order
    And the run history lists it first
