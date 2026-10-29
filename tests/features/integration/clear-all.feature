@FR-21
Feature: Clear All dismisses one view's New jobs
  As the owner,
  I want to dismiss every New job of one view at once,
  so that New only shows what my next search finds.

  Background:
    Given the board has these jobs:
      | title          | view          | status  |
      | Senior SDET    | LinkedIn      | New     |
      | QA Lead        | LinkedIn      | New     |
      | Test Architect | LinkedIn      | Saved   |
      | QA Engineer    | LinkedIn      | Applied |
      | Feed SDET      | Other sources | New     |

  Scenario: Only the chosen view's New jobs move to Dismissed
    When I use Clear All on the LinkedIn view
    Then 2 jobs are dismissed
    And the jobs have these statuses:
      | title          | status    |
      | Senior SDET    | Dismissed |
      | QA Lead        | Dismissed |
      | Test Architect | Saved     |
      | QA Engineer    | Applied   |
      | Feed SDET      | New       |
    And "Senior SDET" and "QA Lead" each have one history row from New to Dismissed

  Scenario: A later run that finds a dismissed job again leaves it dismissed
    Given I used Clear All on the LinkedIn view
    When a later run receives "Senior SDET"
    Then "Senior SDET" is Dismissed and has been seen 2 times
