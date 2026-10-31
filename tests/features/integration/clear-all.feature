@FR-21
Feature: Clear All dismisses one view's New jobs
  As the owner,
  I want to dismiss every New job of one view at once,
  so that New only shows what my next search finds.

  Background:
    Given the board has these jobs:
      | title          | view          | status  |
      | Senior Dispatcher    | LinkedIn      | New     |
      | Lead Nurse        | LinkedIn      | New     |
      | Test Architect | LinkedIn      | Saved   |
      | Nurse Educator    | LinkedIn      | Applied |
      | Feed Dispatcher      | Other sources | New     |

  Scenario: Only the chosen view's New jobs move to Dismissed
    When I use Clear All on the LinkedIn view
    Then 2 jobs are dismissed
    And the jobs have these statuses:
      | title          | status    |
      | Senior Dispatcher    | Dismissed |
      | Lead Nurse        | Dismissed |
      | Test Architect | Saved     |
      | Nurse Educator    | Applied   |
      | Feed Dispatcher      | New       |
    And "Senior Dispatcher" and "Lead Nurse" each have one history row from New to Dismissed

  Scenario: A later run that finds a dismissed job again leaves it dismissed
    Given I used Clear All on the LinkedIn view
    When a later run receives "Senior Dispatcher"
    Then "Senior Dispatcher" is Dismissed and has been seen 2 times
