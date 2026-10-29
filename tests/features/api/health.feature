@NFR-01
Feature: The app's health
  As the owner,
  I want the app to answer only on my own computer and to say whether it is well,
  so that nothing on the network can reach my job search.

  Scenario: The app answers on the loopback address and reports itself and its database as ok
    When I ask the app whether it is healthy
    Then it answers on the loopback address only
    And it reports itself and its database as ok
