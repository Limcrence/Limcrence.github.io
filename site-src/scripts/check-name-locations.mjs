import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {personLocations,isPersonMatch} from '../src/lib/name-locations.ts';
const library=JSON.parse(await fs.readFile(new URL('../../reading-practice-web/app/data/library.json',import.meta.url),'utf8'));
const seen=new Set();let occurrences=0,questions=0;
for(const q of library.questions.filter(isPersonMatch)){
  questions++;const article=library.articles.find(a=>a.id===q.article_id),people=personLocations(q,article);
  assert.equal(people.length,Object.keys(q.options).length);
  for(const person of people){assert.ok(person.mentions.length,person.label);for(const m of person.mentions){assert.ok(m.start>=0&&m.end>m.start&&m.end<=article.paragraphs[m.paragraphIndex].text.length);assert.equal(m.key,person.key);}
    const key=q.article_id+person.label;if(!seen.has(key)){seen.add(key);occurrences+=person.mentions.length;}
  }
}
const q={question_type:'人名匹配',options:{A:'Mark VanDam',B:'Nairan Ramirez-Esparza',C:'Felix Preston and Johanna Lehne',D:'John Smith',E:'Mary Smith'}};
const text='Mark Van Dam met Nairan Ramírez–Esparza. Van Dam replied. Ramirez-Esparza agreed. Felix Preston and Johanna Lehne spoke; Preston and Lehne nodded. John Smith met Mary Smith. Smith left.';
const article={paragraphs:[{label:'A',text}]},people=personLocations(q,article);
assert.equal(people[0].mentions.length,2);assert.equal(people[1].mentions.length,2);assert.equal(people[2].mentions.length,4);
assert.equal(people[3].mentions.length,1);assert.equal(people[4].mentions.length,1);
assert.equal(text.slice(people[1].mentions[0].start,people[1].mentions[0].end),'Nairan Ramírez–Esparza');
assert.equal(personLocations({question_type:'选择题',options:q.options},article).length,0);
console.log(JSON.stringify({personQuestions:questions,uniquePeopleOptions:seen.size,uniqueOccurrences:occurrences,fullNamesAndSurnames:true,combinedNames:true,diacriticsAndHyphens:true,spacedVanDam:true,ambiguousSurnamesNotMisattributed:true}));
