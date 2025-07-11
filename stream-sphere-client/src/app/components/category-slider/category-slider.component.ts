import { Component, ElementRef, EventEmitter,Output,ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-category-slider',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './category-slider.component.html',
  styleUrls: ['./category-slider.component.css']
})
export class CategorySliderComponent {

  categories: string[] = [
    'Music', 'Gaming', 'Sports', 'Movies', 'Comedy', 'Web Series',
    'Learning', 'Podcasts', 'News', 'Fitness', 'Vlogs', 'Travel',
    'Tech', 'Food & Recipes', 'Motivation', 'Short Films', 'Art & Design',
    'Fashion', 'Kids', 'History', 'DIY', 'Documentaries', 'Spirituality',
    'Uncategorized'
  ];

  selectedCategory = 'All';

  @ViewChild('scrollContainer', { static: false }) scrollContainer!: ElementRef;
  @Output() categorySelected = new EventEmitter<string>();
  
  selectCategory(category: string) {
    this.selectedCategory = category;
    this.categorySelected.emit(category);
  }
  scrollLeft() {
this.scrollContainer.nativeElement.scrollBy({left:-150,behavior:'smooth'});  }

  scrollRight() {
    this.scrollContainer.nativeElement.scrollBy({left:150,behavior:'smooth'});  
  }

}

