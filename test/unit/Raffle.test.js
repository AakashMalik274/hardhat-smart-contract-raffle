const { assert, expect } = require("chai")
const { network, deployments, getNamedAccounts, ethers } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle Unit Tests", () => {
          let Raffle, VRFCoordinatorV2Mock, raffleEntranceFee, deployer, interval
          const chainId = network.config.chainId

          beforeEach(async () => {
              deployer = (await getNamedAccounts()).deployer

              await deployments.fixture("all")

              Raffle = await ethers.getContract("Raffle", deployer)
              VRFCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer)

              raffleEntranceFee = await Raffle.getEntranceFee()
              interval = await Raffle.getInterval()
          })

          describe("constructor", () => {
              it("initializes the Raffle Correctly", async () => {
                  //ideally we make our tests 1 assert per "it"
                  const raffleState = await Raffle.getRaffleState()

                  assert.equal(raffleState.toString(), "0", "Raffle State Not Initialised properly")
                  assert.equal(
                      interval.toString(),
                      networkConfig[chainId]["interval"],
                      "Interval not Initialised properly"
                  )
              })
          })

          describe("enterRaffle", () => {
              it("reverts when you don't pay enough", async () => {
                  await expect(Raffle.enterRaffle()).to.be.revertedWith(
                      "Raffle__NotEnoughETHEntered"
                  )
              })

              it("records players when they enter", async () => {
                  await Raffle.enterRaffle({ value: raffleEntranceFee })

                  const playerFromContract = await Raffle.getPlayers(0)
                  assert.equal(
                      playerFromContract,
                      deployer,
                      "player didn't get added to data structure"
                  )
              })

              it("emits event on enter", async () => {
                  await expect(Raffle.enterRaffle({ value: raffleEntranceFee }))
                      .to.emit(Raffle, "raffleEnter")
                      .withArgs(deployer)
              })

              it("does not allow enter when raffle is calculating", async () => {
                  await Raffle.enterRaffle({ value: raffleEntranceFee })

                  //increasing time on out hardhat manually using special JSON RPC Methods by hardhat
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])

                  //pretending to be chainLink Keeper
                  await Raffle.performUpkeep([])

                  await expect(Raffle.enterRaffle({ value: raffleEntranceFee })).to.be.revertedWith(
                      "Raffle__NotOpen"
                  )
              })
          })

          describe("checkUpkeep", () => {
              it("returns false when people haven't send any ETH", async () => {
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])

                  //callStatic is used to not send a tx but to simulate sending the tx of calling a function
                  const { upkeepNeeded } = await Raffle.callStatic.checkUpkeep([])
                  assert(!upkeepNeeded)
              })
              it("returns false if Raffle isn't open", async () => {
                  await Raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])

                  await Raffle.performUpkeep("0x")
                  const raffleState = await Raffle.getRaffleState()

                  const { upkeepNeeded } = await Raffle.callStatic.checkUpkeep([])
                  assert.equal(raffleState.toString(), "1")
                  assert.equal(upkeepNeeded, false)
              })
              it("returns false if enough time hasn't passed", async () => {
                  await Raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() - 5])
                  await network.provider.send("evm_mine", [])

                  const { upkeepNeeded } = await Raffle.callStatic.checkUpkeep([])
                  assert(!upkeepNeeded)
              })
              it("returns true if enough time has passed, has players, eth, and is open", async () => {
                  await Raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])

                  const { upkeepNeeded } = await Raffle.callStatic.checkUpkeep([])
                  assert(upkeepNeeded)
              })
          })

          describe("performUpkeep", () => {
              it("it can only run if checkUpkeep is true", async () => {
                  await Raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])

                  const tx = await Raffle.performUpkeep([])
                  assert(tx)
              })
              it("reverts when checkUpkeep is false", async () => {
                  await expect(Raffle.performUpkeep([])).to.be.revertedWith(
                      "Raffle__UpkeepNotNeeded"
                  )
              })
              it("updates the state,emits an event,calls a vrf coordinator", async () => {
                  await Raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])

                  const txResponse = await Raffle.performUpkeep([])
                  const txReceipt = await txResponse.wait(1)

                  const requestId = txReceipt.events[1].args.requestId
                  const raffleState = await Raffle.getRaffleState()

                  assert(requestId.toNumber() > 0, "Didn't get RequestID")
                  assert(raffleState == 1, "RaffleState not calculating")
              })
          })

          describe("fulfillRandomWords", () => {
              beforeEach(async () => {
                  await Raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
              })
              it("can only be called after performUpkeep", async () => {
                  await expect(
                      VRFCoordinatorV2Mock.fulfillRandomWords(0, Raffle.address)
                  ).to.be.revertedWith("nonexistent request")
              })
              it("picks a winner,resets the lottery and sends some money", async () => {
                  const additionalEntrants = 3
                  const startingAccountIndex = 1 //deployer = 0
                  const accounts = await ethers.getSigners()

                  for (
                      let i = startingAccountIndex;
                      i < startingAccountIndex + additionalEntrants;
                      i++
                  ) {
                      const raffleConnectedContract = await Raffle.connect(accounts[i])
                      await raffleConnectedContract.enterRaffle({ value: raffleEntranceFee })
                  }

                  const startingTimeStamp = await Raffle.getLatestTimeStamp()

                  //performUpkeep (mock being chainlink automation)
                  //fulfillrandomwords (mock being VRF)

                  await new Promise(async (resolve, reject) => {
                      //Listen for this "WinnerPicked" event, once it happens, do some stuff
                      Raffle.once("WinnerPicked", async () => {
                          console.log("Found the event...")
                          try {
                              const recentWinner = await Raffle.getRecentWinner()
                              const raffleState = await Raffle.getRaffleState()
                              const numOfPlayers = await Raffle.getNumberOfPlayers()
                              const endingTimeStamp = await Raffle.getLatestTimeStamp()

                              const winnerEndingBalance = await accounts[1].getBalance()

                              assert.equal(raffleState.toString(), "0", "Raffle State Not Open")
                              assert.equal(numOfPlayers.toString(), "0", "Player Array not reset")
                              assert(endingTimeStamp > startingTimeStamp)
                              assert.equal(
                                  winnerEndingBalance.toString(),
                                  winnerStartingBalance
                                      .add(
                                          raffleEntranceFee
                                              .mul(additionalEntrants)
                                              .add(raffleEntranceFee)
                                      )
                                      .toString(),
                                  "Balance not credited to winner"
                              )
                          } catch (e) {
                              reject(e)
                          }
                          resolve()
                      })
                      //setting up the listener

                      //below, we will fire the event, and the listener will pick it up and resolve
                      const tx = await Raffle.performUpkeep([])
                      const txReceipt = await tx.wait(1)
                      const winnerStartingBalance = await accounts[1].getBalance()

                      await VRFCoordinatorV2Mock.fulfillRandomWords(
                          txReceipt.events[1].args.requestId,
                          Raffle.address
                      )
                  })
              })
          })
      })
