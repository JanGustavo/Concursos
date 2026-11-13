import React from 'react';

const LABELS = {new:'Nunca estudei',active:'Em estudo',done:'Concluído'};

export function StageBadge({stage='new'}) {
 const value=Object.hasOwn(LABELS,stage)?stage:'new';
 return <span className="stage-badge" data-stage={value}>{LABELS[value]}</span>;
}
