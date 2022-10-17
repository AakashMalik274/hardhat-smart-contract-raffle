const { assert, expect } = require("chai")
const { network, deployments, getNamedAccounts, ethers } = require("hardhat")
const { isCallTrace } = require("hardhat/internal/hardhat-network/stack-traces/message-trace")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")

developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle", () => {
          let Raffle, raffleEntranceFee, deployer

          beforeEach(async () => {
              deployer = (await getNamedAccounts()).deployer
              Raffle = await ethers.getContract("Raffle", deployer)
              raffleEntranceFee = await Raffle.getEntranceFee()
          })
          describe("fulfillRandomWords", () => {
              it("works with live chainlink automation and chainlink VRF and we get a random winner", async () => {
                  //enter the raffle
                  const startingTimeStamp = await Raffle.getLatestTimeStamp()
                  const accounts = await ethers.getSigners()

                  //setup listener before we enter raffle
                  //incase blockchain moves really fast
                  await new Promise(async (resolve, reject) => {
                      Raffle.once("WinnerPicked", async () => {
                          console.log("WinnerPicked event got emitted")
                          try {
                              const recentWinner = await Raffle.getRecentWinner()
                              const raffleState = await Raffle.getRaffleState()
                              const winnerEndingBalance = await accounts[0].getBalance()
                              const endingTimeStamp = await Raffle.getLatestTimeStamp()

                              await expect(Raffle.getPlayers(0), "Player not equal").to.be.reverted
                              assert.equal(
                                  recentWinner.toString(),
                                  accounts[0].address,
                                  "Address not equal"
                              )
                              assert.equal(raffleState.toString(), "0", "state not equal")
                              assert.equal(
                                  winnerEndingBalance.toString(),
                                  winnerStartingBalance.add(raffleEntranceFee).toString(),
                                  "Balance not equal"
                              )
                              assert(endingTimeStamp > startingTimeStamp)
                          } catch (e) {
                              reject(e)
                          }
                          resolve()
                      })
                      await Raffle.enterRaffle({ value: raffleEntranceFee })
                      const winnerStartingBalance = await accounts[0].getBalance()
                  })
              })
          })
      })
