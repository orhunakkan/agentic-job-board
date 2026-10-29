@FR-07
Feature: Filtering the job list
  As the owner,
  I want to narrow the list by view, tab, score and text, and choose its order,
  so that I see the jobs worth my time first.

  Background:
    Given the board has these jobs:
      | title       | company  | view          | score | status |
      | Strong SDET | Top Co   | LinkedIn      | 91    | New    |
      | Possible QA | Mid Co   | LinkedIn      | 60    | New    |
      | Weak Tester | Low Co   | LinkedIn      | 20    | New    |
      | Unscored QA | Plain Co | LinkedIn      |       | New    |
      | Saved SDET  | Keep Co  | LinkedIn      | 80    | Saved  |
      | Feed SDET   | Feed Co  | Other sources | 85    | New    |

  Scenario: The New tab lists the best scores first and unscored jobs last
    When I list the New tab of the LinkedIn view
    Then the list is "Strong SDET", "Possible QA", "Weak Tester" and "Unscored QA", in that order

  @FR-17
  Scenario: Each view lists only its own jobs
    When I list the New tab of the Other sources view
    Then the list is "Feed SDET"

  Scenario: Each tab lists only the jobs with its statuses
    When I list the Saved tab of the LinkedIn view
    Then the list is "Saved SDET"

  Scenario: A minimum score leaves out the weaker and the unscored jobs
    When I list the New tab of the LinkedIn view with a minimum score of 50
    Then the list is "Strong SDET" and "Possible QA", in that order

  Scenario Outline: Searching for "<text>" finds a job by its <field>
    When I list the New tab of the LinkedIn view, searching for "<text>"
    Then the list is "<job>"

    Examples:
      | text   | field   | job         |
      | tester | title   | Weak Tester |
      | Mid Co | company | Possible QA |

  Scenario: Newest first puts the jobs the board found last at the top
    When I list the New tab of the LinkedIn view, newest first
    Then the list is "Unscored QA", "Weak Tester", "Possible QA" and "Strong SDET", in that order
