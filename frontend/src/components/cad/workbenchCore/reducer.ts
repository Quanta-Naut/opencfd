import { CadState, CadAction } from './types';

export function cadReducer(state: CadState, action: CadAction): CadState {
  switch (action.type) {
    case 'ADD_ENTITY':
      return { entities: [...state.entities, action.entity] };
    case 'REPLACE_ENTITIES':
      return { entities: action.entities };
    case 'DELETE_SELECTED':
      return { entities: state.entities.filter(e => !e.selected) };
    case 'SELECT_ENTITY':
      return {
        entities: state.entities.map(e => ({
          ...e,
          selected: action.multi
            ? (e.id === action.id ? !e.selected : e.selected)
            : e.id === action.id,
        })),
      };
    case 'CLEAR':
      return { entities: [] };
    default:
      return state;
  }
}
