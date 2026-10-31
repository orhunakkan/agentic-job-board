@FR-07
Feature: Filtering the job list
  As the owner,
  I want to narrow the list by view, tab, score and text, and choose its order,
  so that I see the jobs worth my time first.

  Background:
    Given the board has these jobs:
      | title       | company  | view          | score | status |
      | Strong Dispatcher | Top Co   | LinkedIn      | 91    | New    |
      | Possible Nurse | Mid Co   | LinkedIn      | 60    | New    |
      | Weak Courier | Low Co   | LinkedIn      | 20    | New    |
      | Unscored Nurse | Plain Co | LinkedIn      |       | New    |
      | Saved Dispatcher  | Keep Co  | LinkedIn      | 80    | Saved  |
      | Feed Dispatcher   | Feed Co  | Other sources | 85    | New    |

  Scenario: The New tab lists the best scores first and unscored jobs last
    When I list the New tab of the LinkedIn view
    Then the list is "Strong Dispatcher", "Possible Nurse", "Weak Courier" and "Unscored Nurse", in that order

  @FR-17
  Scenario: Each view lists only its own jobs
    When I list the New tab of the Other sources view
    Then the list is "Feed Dispatcher"

  Scenario: Each tab lists only the jobs with its statuses
    When I list the Saved tab of the LinkedIn view
    Then the list is "Saved Dispatcher"

  Scenario: A minimum score leaves out the weaker and the unscored jobs
    When I list the New tab of the LinkedIn view with a minimum score of 50
    Then the list is "Strong Dispatcher" and "Possible Nurse", in that order

  Scenario Outline: Searching for "<text>" finds a job by its <field>
    When I list the New tab of the LinkedIn view, searching for "<text>"
    Then the list is "<job>"

    Examples:
      | text   | field   | job         |
      | courier | title   | Weak Courier |
      | Mid Co | company | Possible Nurse |

  Scenario: Newest first puts the jobs the board found last at the top
    When I list the New tab of the LinkedIn view, newest first
    Then the list is "Unscored Nurse", "Weak Courier", "Possible Nurse" and "Strong Dispatcher", in that order
