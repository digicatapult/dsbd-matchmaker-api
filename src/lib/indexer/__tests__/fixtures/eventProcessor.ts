import { ChangeSet } from '../../changeSet'
import { EventProcessors } from '../../eventProcessor'
import sinon from 'sinon'

export const withMockEventProcessors: (result?: ChangeSet) => EventProcessors = (result: ChangeSet = {}) => ({
  'demand-create': sinon.stub().returns(result),
  'match2-propose': sinon.stub().returns(result),
  'match2-accept': sinon.stub().returns(result),
  'match2-acceptFinal': sinon.stub().returns(result),
})
