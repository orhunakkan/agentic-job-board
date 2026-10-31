@FR-10
Feature: A job's details
  As the owner,
  I want a job's details to hold everything the board knows about it,
  so that I can decide what to do without looking elsewhere.

  Scenario: A job's details include its sightings and its status history
    Given an earlier run received the LinkedIn job "Senior Dispatcher" from the search "Dispatch family"
    And a later run received the LinkedIn job "Senior Dispatcher" from the search "Senior accounting"
    And I saved "Senior Dispatcher"
    When I look at "Senior Dispatcher"
    Then it has 2 sightings, by the searches "Dispatch family" and "Senior accounting"
    And its status history is:
      | from | to    |
      |      | New   |
      | New  | Saved |

  Scenario: A job that doesn't exist is not found
    When I look at a job that doesn't exist
    Then the job is not found
